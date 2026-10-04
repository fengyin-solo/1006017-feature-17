<template>
  <section class="page" data-module="cabin">
    <header class="page-head">
      <div>
        <h2>客舱清洁管理</h2>
        <p class="page-desc">维护清洁作业，围绕作业编号、航班号、清洁班组、作业项数做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记清洁作业</button>
        <button class="btn" type="button" @click="exportRows">导出客舱清洁清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="team-view">
      <h3 class="section-title">班组完成视图</h3>
      <p class="section-desc">按清洁班组分组汇总，项数、用水量、耗材领用与下方作业记录同源；点击航班可下钻明细。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>清洁班组</th>
            <th>作业架次</th>
            <th>作业项数</th>
            <th>用水量</th>
            <th>耗材领用</th>
            <th>涉及航班（点击下钻）</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="team in teamView"
            :key="team.team"
            :class="{ 'row-active': team.team === drillTeam }"
          >
            <td>{{ team.team }}</td>
            <td>{{ team.jobs }}</td>
            <td>{{ team.itemTotal }}</td>
            <td>{{ team.waterTotal }}</td>
            <td>{{ team.supplyTotal }}</td>
            <td class="flight-cell">
              <button
                v-for="flight in team.flights"
                :key="flight"
                class="link flight-chip"
                type="button"
                @click="openDrill(team.team, flight)"
              >
                {{ flight }}
              </button>
            </td>
          </tr>
          <tr v-if="teamView.length" class="total-row">
            <td>合计</td>
            <td>{{ teamTotals.jobs }}</td>
            <td>{{ teamTotals.itemTotal }}</td>
            <td>{{ teamTotals.waterTotal }}</td>
            <td>{{ teamTotals.supplyTotal }}</td>
            <td>—</td>
          </tr>
          <tr v-if="!teamView.length">
            <td colspan="6" class="empty-state">暂无清洁作业，班组视图待数据生成</td>
          </tr>
        </tbody>
      </table>

      <div v-if="drill" class="drill-panel">
        <header class="drill-head">
          <h4 class="drill-title">{{ drill.team }} · {{ drill.flight }} 作业明细</h4>
          <label class="drill-switch">
            <span>切换航班</span>
            <select :value="drill.flight" @change="switchFlight">
              <option v-for="flight in drillTeamFlights" :key="flight" :value="flight">
                {{ flight }}
              </option>
            </select>
          </label>
        </header>
        <p v-if="drill.supportTeam" class="drill-note">
          保障班组：{{ drill.supportTeam }}，本航班耗材领用 {{ drill.supply }} 套，已计入该班组领用清单。
        </p>
        <p v-else class="drill-note warn-text">该航班未登记保障班组，耗材暂未挂接。</p>
        <p v-if="drill.issue?.warning" class="warn-text">⚠ {{ drill.issue.warning }}</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>作业编号</th>
              <th>航班号</th>
              <th>作业项数</th>
              <th>已完成项数</th>
              <th>用水量</th>
              <th>耗材领用</th>
              <th>当前状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="job in drill.jobs" :key="String(job.id)">
              <td>{{ job['作业编号'] }}</td>
              <td>{{ job['航班号'] }}</td>
              <td>{{ job['作业项数'] }}</td>
              <td>{{ job['已完成项数'] }}</td>
              <td>{{ job['用水量'] }}</td>
              <td>{{ job['耗材领用'] }}</td>
              <td>{{ job.status }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="recordProgress(row)">补记完成项数</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无客舱清洁数据，可先登记清洁作业</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条客舱清洁记录</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  cabinFlightDetail,
  cabinTeamSummary,
  downloadEntries,
  listEntries,
  moduleMeta,
  recordCabinProgress,
  runAction as applyAction,
} from '@/api/local-service'
import type { CabinFlightDetail, CabinTeamSummary, EntryRow } from '@/data/types'

const meta = moduleMeta('cabin')
const columns = ["作业编号", "航班号", "清洁班组", "作业项数", "已完成项数", "用水量", "耗材领用", "质检人员"]
const actions = ["开始清洁", "提交质检", "确认完成"]
const statuses = ["待清洁", "清洁中", "待质检", "已完成"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const teamView = ref<CabinTeamSummary[]>([])
const drillTeam = ref('')
const drill = ref<CabinFlightDetail | null>(null)

const stats = computed(() => [
  { label: '今日清洁架次', value: rows.value.length },
  { label: '清洁中作业', value: rows.value.filter((row) => String(row.status) === '清洁中').length },
  { label: '待质检作业', value: rows.value.filter((row) => String(row.status) === '待质检').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const teamTotals = computed(() =>
  teamView.value.reduce(
    (sum, team) => ({
      jobs: sum.jobs + team.jobs,
      itemTotal: sum.itemTotal + team.itemTotal,
      waterTotal: sum.waterTotal + team.waterTotal,
      supplyTotal: sum.supplyTotal + team.supplyTotal,
    }),
    { jobs: 0, itemTotal: 0, waterTotal: 0, supplyTotal: 0 },
  ),
)
const drillTeamFlights = computed(
  () => teamView.value.find((team) => team.team === drillTeam.value)?.flights ?? [],
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '清洁作业登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action)
  showResult(result)
}

function recordProgress(row: EntryRow) {
  const result = recordCabinProgress(Number(row.id))
  showResult(result)
}

function showResult(result: { ok: boolean; message: string }) {
  if (result.ok) {
    reload()
    noticeMessage.value = result.message
    return
  }
  errorMessage.value = result.message
}

function openDrill(team: string, flight: string) {
  drillTeam.value = team
  drill.value = cabinFlightDetail(team, flight)
}

function switchFlight(event: Event) {
  const flight = (event.target as HTMLSelectElement).value
  openDrill(drillTeam.value, flight)
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    teamView.value = cabinTeamSummary()
    if (drill.value) {
      drill.value = cabinFlightDetail(drill.value.team, drill.value.flight)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '客舱清洁列表读取失败'
  }
}

onMounted(reload)
</script>
