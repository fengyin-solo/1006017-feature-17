import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  CabinFlightDetail,
  CabinTeamSummary,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  SupplyFlight,
  TeamSupplyIssue,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 动作级业务校验：返回 null 放行，返回字符串则拦截并作为提示文案。
const ACTION_GUARDS: Record<string, (row: EntryRow) => string | null> = {
  // 项数没做全的清洁作业不许提交质检。
  'cabin:提交质检': (row) => {
    const total = toNumber(row['作业项数'])
    const done = toNumber(row['已完成项数'])
    return done >= total
      ? null
      : `作业项数未做全（已完成 ${done}/${total} 项），不许提交质检`
  },
}

function toNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  // 同一作业重复提交质检只记一次：已送检（含已检完）的作业再次提交直接拦下。
  if (key === 'cabin' && action === '提交质检' && (current === '待质检' || current === '已完成')) {
    return { ok: false, message: `该作业已提交过质检（当前「${current}」），同一作业重复提交只记一次` }
  }
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (meta.enforceSequence) {
    const flow = meta.statuses.join('→')
    if (current === meta.statuses[meta.statuses.length - 1]) {
      return { ok: false, message: `「${current}」是终态，完成记录不能回退到「${target}」` }
    }
    const currentIndex = meta.statuses.indexOf(current)
    if (meta.statuses.indexOf(target) !== currentIndex + 1) {
      return { ok: false, message: `作业状态须按 ${flow} 逐段推进，不能从「${current}」直接到「${target}」` }
    }
  }
  const guard = ACTION_GUARDS[`${key}:${action}`]
  if (guard) {
    const blocked = guard(rows[index])
    if (blocked) {
      return { ok: false, message: blocked }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// —— 客舱清洁：班组完成视图与耗材核对 ——
// 视图、明细、保障班组领用清单都从这里取数，同源同一份，不会各算各的。

const CABIN_KEY = 'cabin'
const FLIGHT_KEY = 'flight'
const TEAM_KEY = 'team'

/** 人均耗材定额（套/人），核对领用量与在岗人数是否匹配的基准。 */
export const SUPPLY_QUOTA_PER_PERSON = 2
/** 人均领用超过定额的这个倍数即视为明显不匹配。 */
export const SUPPLY_WARN_RATIO = 1.2
/** 航班没登记保障班组时耗材归入的兜底桶，保证领用总量在清单里对得上。 */
export const UNASSIGNED_TEAM = '（未挂接保障班组）'

function cabinRows(): EntryRow[] {
  return listRows(CABIN_KEY)
}

/** 航班号 → 保障班组，来自航班保障模块的登记。 */
function flightSupportTeams(): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of listRows(FLIGHT_KEY)) {
    const flight = String(row['航班号'] ?? '')
    const team = String(row['保障班组'] ?? '')
    if (flight && team) {
      map.set(flight, team)
    }
  }
  return map
}

/** 班组名称 → 在岗人数，来自保障班组模块的登记。 */
function teamHeadcounts(): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of listRows(TEAM_KEY)) {
    const name = String(row['班组名称'] ?? '')
    if (name) {
      map.set(name, toNumber(row['在岗人数']))
    }
  }
  return map
}

/** 按清洁班组分组的完成视图：项数、用水量、耗材领用全部聚合自清洁作业记录。 */
export function cabinTeamSummary(): CabinTeamSummary[] {
  const groups = new Map<string, CabinTeamSummary & { flightSet: Set<string> }>()
  for (const row of cabinRows()) {
    const team = String(row['清洁班组'] ?? '') || '未分组'
    let group = groups.get(team)
    if (!group) {
      group = { team, jobs: 0, itemTotal: 0, waterTotal: 0, supplyTotal: 0, flights: [], flightSet: new Set() }
      groups.set(team, group)
    }
    group.jobs += 1
    group.itemTotal += toNumber(row['作业项数'])
    group.waterTotal += toNumber(row['用水量'])
    group.supplyTotal += toNumber(row['耗材领用'])
    const flight = String(row['航班号'] ?? '')
    if (flight && !group.flightSet.has(flight)) {
      group.flightSet.add(flight)
      group.flights.push(flight)
    }
  }
  return [...groups.values()]
    .map(({ flightSet, ...summary }) => summary)
    .sort((a, b) => a.team.localeCompare(b.team, 'zh-Hans-CN'))
}

/** 下钻明细：同一批清洁作业记录按 清洁班组 + 航班号 过滤，与汇总视图同源。 */
export function cabinFlightDetail(team: string, flight: string): CabinFlightDetail {
  const jobs = cabinRows().filter(
    (row) => String(row['清洁班组'] ?? '') === team && String(row['航班号'] ?? '') === flight,
  )
  const supportTeam = flightSupportTeams().get(flight) ?? null
  const supply = jobs.reduce((sum, row) => sum + toNumber(row['耗材领用']), 0)
  const issue = supportTeam
    ? teamSupplyIssues().find((item) => item.team === supportTeam) ?? null
    : null
  return { team, flight, jobs, supportTeam, supply, issue }
}

/**
 * 保障班组的耗材领用清单：清洁作业的耗材领用按 航班号→保障班组 挂接汇总。
 * 领用量与在岗人数明显不匹配时，warning 里写明测算依据。
 */
export function teamSupplyIssues(): TeamSupplyIssue[] {
  const supportOf = flightSupportTeams()
  const headcounts = teamHeadcounts()
  const byTeam = new Map<string, Map<string, number>>()
  for (const row of cabinRows()) {
    const flight = String(row['航班号'] ?? '')
    const team = supportOf.get(flight) ?? UNASSIGNED_TEAM
    let flights = byTeam.get(team)
    if (!flights) {
      flights = new Map<string, number>()
      byTeam.set(team, flights)
    }
    flights.set(flight, (flights.get(flight) ?? 0) + toNumber(row['耗材领用']))
  }
  // 在册班组即使暂无领用也出现在清单里，班组读到的是同一份数。
  for (const name of headcounts.keys()) {
    if (!byTeam.has(name)) {
      byTeam.set(name, new Map())
    }
  }
  const limitPerPerson = SUPPLY_QUOTA_PER_PERSON * SUPPLY_WARN_RATIO
  const issues: TeamSupplyIssue[] = []
  for (const [team, flights] of byTeam) {
    const flightList: SupplyFlight[] = [...flights.entries()].map(([flight, supply]) => ({ flight, supply }))
    const supplyTotal = flightList.reduce((sum, item) => sum + item.supply, 0)
    const headcount = headcounts.get(team) ?? null
    const perPerson = headcount && headcount > 0 ? supplyTotal / headcount : null
    let warning: string | null = null
    if (team === UNASSIGNED_TEAM) {
      warning = supplyTotal > 0 ? '涉及航班未登记保障班组，请先在航班保障中维护后再核对' : null
    } else if (headcount === null || headcount <= 0) {
      warning = supplyTotal > 0 ? '未登记在岗人数，无法核对领用量是否匹配' : null
    } else if (perPerson !== null && perPerson > limitPerPerson) {
      const topFlight = flightList.reduce((max, item) => (item.supply > max.supply ? item : max), flightList[0])
      warning =
        `领用 ${supplyTotal} 套 ÷ 在岗 ${headcount} 人 = 人均 ${perPerson.toFixed(1)} 套，` +
        `超过核对线 ${SUPPLY_QUOTA_PER_PERSON} 套/人 上浮 ${Math.round((SUPPLY_WARN_RATIO - 1) * 100)}%（${limitPerPerson.toFixed(1)} 套/人），` +
        `领用量与在岗人数明显不匹配；其中航班 ${topFlight.flight} 领用 ${topFlight.supply} 套占比最高`
    }
    issues.push({ team, headcount, supplyTotal, flights: flightList, perPerson, quota: SUPPLY_QUOTA_PER_PERSON, warning })
  }
  return issues.sort((a, b) => a.team.localeCompare(b.team, 'zh-Hans-CN'))
}

/** 补记完成项数：仅「清洁中」的作业可补记，项数做全后提示可直接提交质检。 */
export function recordCabinProgress(id: number): ActionResult {
  const rows = listRows(CABIN_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的清洁作业` }
  }
  const row = rows[index]
  if (String(row.status) !== '清洁中') {
    return { ok: false, message: `只有「清洁中」的作业才能补记完成项数，当前状态「${String(row.status)}」` }
  }
  const total = toNumber(row['作业项数'])
  const done = toNumber(row['已完成项数'])
  if (done >= total) {
    return { ok: false, message: `作业项数已做全（${done}/${total}），可以直接提交质检` }
  }
  const next = [...rows]
  next[index] = { ...row, 已完成项数: done + 1 }
  saveRows(CABIN_KEY, next)
  return { ok: true, message: `已补记 1 项，当前完成 ${done + 1}/${total} 项` }
}
