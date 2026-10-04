import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 客舱清洁的领域规则都收在这里：班组完成视图、航班下钻、耗材挂账、状态推进
// 读的都是 listRows('cabin') 这一份作业记录，视图合计与明细列表同源，不会各算各的。

const CABIN_KEY = 'cabin'
const FLIGHT_KEY = 'flight'
const TEAM_KEY = 'team'

// 作业状态只能沿这条链逐段推进，不许跳步、不许回退。
const FLOW = ['待清洁', '清洁中', '待质检', '已完成'] as const
const ACTION_STEPS: Record<string, { from: string; to: string }> = {
  开始清洁: { from: '待清洁', to: '清洁中' },
  提交质检: { from: '清洁中', to: '待质检' },
  确认完成: { from: '待质检', to: '已完成' },
}

// 人岗匹配的判定依据：人均耗材定额 4 件/人，超过 1.5 倍视为明显超领，不足 0.25 倍视为明显偏少。
export const MATERIAL_QUOTA_PER_PERSON = 4
export const MATERIAL_OVER_RATIO = 1.5
export const MATERIAL_UNDER_RATIO = 0.25

export type CabinTotals = {
  jobs: number
  plannedItems: number
  doneItems: number
  waterTotal: number
  materialTotal: number
}

export type TeamSummaryRow = CabinTotals & {
  team: string
  flights: string[]
}

export type MaterialIssueRow = {
  team: string
  onDuty: number | null
  materialTotal: number
  flights: string[]
  perCapita: number | null
  warning: string
}

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function cabinRows(): EntryRow[] {
  return listRows(CABIN_KEY)
}

// 本周口径：周一 00:00 起算，按作业日期过滤。
export function isCurrentWeek(dateStr: string, now: Date = new Date()): boolean {
  const date = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    return false
  }
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const nextMonday = new Date(monday)
  nextMonday.setDate(nextMonday.getDate() + 7)
  return date >= monday && date < nextMonday
}

// 汇总与明细共用的同一份筛选：航班 + 本周开关。视图合计和作业记录从同一批行里出来。
function scopedCabinRows(flight: string, weekOnly: boolean): EntryRow[] {
  return cabinRows().filter((row) => {
    if (flight && String(row['航班号']) !== flight) {
      return false
    }
    if (weekOnly && !isCurrentWeek(String(row['作业日期'] ?? ''))) {
      return false
    }
    return true
  })
}

// 唯一的合计口：班组汇总、航班小计都用它，保证项数合计与明细加总一致。
export function sumCabinRows(rows: EntryRow[]): CabinTotals {
  return rows.reduce<CabinTotals>(
    (totals, row) => ({
      jobs: totals.jobs + 1,
      plannedItems: totals.plannedItems + num(row['作业项数']),
      doneItems: totals.doneItems + num(row['已完成项数']),
      waterTotal: totals.waterTotal + num(row['用水量']),
      materialTotal: totals.materialTotal + num(row['耗材领用']),
    }),
    { jobs: 0, plannedItems: 0, doneItems: 0, waterTotal: 0, materialTotal: 0 },
  )
}

export function cabinFlights(): string[] {
  const seen = new Set<string>()
  for (const row of cabinRows()) {
    const flight = String(row['航班号'] ?? '')
    if (flight) {
      seen.add(flight)
    }
  }
  return [...seen]
}

// 班组完成视图：按清洁班组分组，作业项数、用水量、耗材领用三项并排。
export function cabinTeamSummary(flight: string, weekOnly: boolean): TeamSummaryRow[] {
  const rows = scopedCabinRows(flight, weekOnly)
  const byTeam = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const team = String(row['清洁班组'] ?? '未分班')
    const bucket = byTeam.get(team) ?? []
    bucket.push(row)
    byTeam.set(team, bucket)
  }
  return [...byTeam.entries()]
    .map(([team, teamRows]) => ({
      team,
      flights: [...new Set(teamRows.map((row) => String(row['航班号'] ?? '')))].filter(Boolean),
      ...sumCabinRows(teamRows),
    }))
    .sort((a, b) => b.plannedItems - a.plannedItems)
}

// 航班下钻明细：与汇总走同一个 scopedCabinRows，看到的就是合计的那批记录。
export function cabinJobDetails(flight: string, weekOnly: boolean): EntryRow[] {
  return scopedCabinRows(flight, weekOnly)
}

// 耗材挂账：清洁作业的耗材领用挂到对应航班的保障班组名下，
// 再对照保障班组台账里的在岗人数做人岗匹配。客舱清洁页和保障班组页都读这一份结果。
export function materialIssueByTeam(): MaterialIssueRow[] {
  const flights = listRows(FLIGHT_KEY)
  const teams = listRows(TEAM_KEY)
  const supportTeamOf = new Map<string, string>()
  for (const row of flights) {
    supportTeamOf.set(String(row['航班号'] ?? ''), String(row['保障班组'] ?? ''))
  }
  const onDutyOf = new Map<string, number>()
  for (const row of teams) {
    onDutyOf.set(String(row['班组名称'] ?? ''), num(row['在岗人数']))
  }

  const issue = new Map<string, { materialTotal: number; flights: Set<string> }>()
  for (const row of cabinRows()) {
    const flight = String(row['航班号'] ?? '')
    const team = supportTeamOf.get(flight) || '未挂账班组'
    const bucket = issue.get(team) ?? { materialTotal: 0, flights: new Set<string>() }
    bucket.materialTotal += num(row['耗材领用'])
    if (flight) {
      bucket.flights.add(flight)
    }
    issue.set(team, bucket)
  }

  const overCap = MATERIAL_QUOTA_PER_PERSON * MATERIAL_OVER_RATIO
  const underCap = MATERIAL_QUOTA_PER_PERSON * MATERIAL_UNDER_RATIO
  return [...issue.entries()]
    .map(([team, bucket]) => {
      const onDuty = onDutyOf.has(team) ? (onDutyOf.get(team) as number) : null
      const perCapita = onDuty !== null && onDuty > 0 ? bucket.materialTotal / onDuty : null
      let warning = ''
      if (onDuty === null) {
        warning = `未在保障班组台账中找到「${team}」，领用 ${bucket.materialTotal} 件无法核对人岗匹配`
      } else if (onDuty <= 0 && bucket.materialTotal > 0) {
        warning = `在岗人数为 0，仍领用 ${bucket.materialTotal} 件，人岗明显不匹配`
      } else if (perCapita !== null && perCapita > overCap) {
        warning = `领用 ${bucket.materialTotal} 件 ÷ 在岗 ${onDuty} 人 = 人均 ${perCapita.toFixed(1)} 件，超出人均定额 ${MATERIAL_QUOTA_PER_PERSON} 件的 ${MATERIAL_OVER_RATIO} 倍（上限 ${overCap} 件/人）`
      } else if (perCapita !== null && bucket.materialTotal > 0 && perCapita < underCap) {
        warning = `领用 ${bucket.materialTotal} 件 ÷ 在岗 ${onDuty} 人 = 人均 ${perCapita.toFixed(1)} 件，低于人均定额 ${MATERIAL_QUOTA_PER_PERSON} 件的 ${MATERIAL_UNDER_RATIO} 倍（下限 ${underCap} 件/人），请核对是否漏记`
      }
      return {
        team,
        onDuty,
        materialTotal: bucket.materialTotal,
        flights: [...bucket.flights],
        perCapita,
        warning,
      }
    })
    .sort((a, b) => b.materialTotal - a.materialTotal)
}

// 状态推进守卫：逐段走、不跳步、项数不全不交质检、已完成不回退、重复交质检只记一次。
export function runCabinAction(id: number, action: string): ActionResult {
  const step = ACTION_STEPS[action]
  if (!step) {
    return { ok: false, message: `清洁作业不支持「${action}」这个动作` }
  }
  const rows = cabinRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的清洁作业` }
  }
  const current = String(rows[index].status)
  if (action === '提交质检' && (current === '待质检' || current === '已完成')) {
    return { ok: false, message: '该作业已提交过质检，重复提交只记一次，当前状态不变' }
  }
  if (current === FLOW[FLOW.length - 1]) {
    return { ok: false, message: '已完成的清洁记录不能回退到清洁中，也不能再流转' }
  }
  if (current !== step.from) {
    return {
      ok: false,
      message: `当前状态「${current}」，须按 ${FLOW.join('→')} 逐段推进，不能跳步`,
    }
  }
  if (action === '提交质检') {
    const planned = num(rows[index]['作业项数'])
    const done = num(rows[index]['已完成项数'])
    if (done < planned) {
      return { ok: false, message: `作业项数未做全（${done}/${planned}），不许提交质检` }
    }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: step.to,
    pending: step.to !== FLOW[FLOW.length - 1],
    abnormal: false,
  }
  if (action === '提交质检') {
    updated['质检提交时间'] = new Date().toLocaleString('zh-CN', { hour12: false })
  }
  const next = [...rows]
  next[index] = updated
  saveRows(CABIN_KEY, next)
  return { ok: true, message: `清洁作业已${action}，当前状态「${step.to}」` }
}

// 登记完成项数：只有清洁中的作业能登记，且不能超过作业项数。
export function updateCabinProgress(id: number, done: number): ActionResult {
  const rows = cabinRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的清洁作业` }
  }
  if (String(rows[index].status) !== '清洁中') {
    return { ok: false, message: '只有清洁中的作业才能登记完成项数' }
  }
  const planned = num(rows[index]['作业项数'])
  if (!Number.isFinite(done) || done < 0) {
    return { ok: false, message: '完成项数必须是不小于 0 的数字' }
  }
  if (done > planned) {
    return { ok: false, message: `完成项数不能超过作业项数（${planned}）` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], 已完成项数: Math.floor(done) }
  saveRows(CABIN_KEY, next)
  return { ok: true, message: `已登记完成项数 ${Math.floor(done)}/${planned}` }
}
