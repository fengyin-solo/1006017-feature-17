<template>
  <section class="page" data-module="cabin">
    <header class="page-head">
      <div>
        <h2>客舱清洁管理</h2>
        <p class="page-desc">维护清洁作业，围绕作业编号、航班号、清洁班组、作业项数做登记、筛选与状态流转，并提供按班组的完成视图。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记清洁作业</button>
        <button class="btn" type="button" @click="exportRows">导出客舱清洁清单</button>
      </div>
    </header>

    <div class="view-switch">
      <button
        class="btn"
        :class="{ active: view === 'records' }"
        type="button"
        @click="view = 'records'"
      >
        作业记录
      </button>
      <button
        class="btn"
        :class="{ active: view === 'teams' }"
        type="button"
        @click="view = 'teams'"
      >
        班组完成视图
      </button>
    </div>

    <template v-if="view === 'records'">
      <div class="stat-row">
        <article v-for="item in stats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

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
              <span v-if="row.status === '清洁中'" class="progress-form">
                <input
                  v-model.number="progressDraft[String(row.id)]"
                  type="number"
                  min="0"
                  :max="Number(row['作业项数'])"
                />
                <button class="link" type="button" @click="saveProgress(row)">登记项数</button>
              </span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无客舱清洁数据，可先登记清洁作业</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条客舱清洁记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <template v-else>
      <div class="filter-bar">
        <label class="filter-item">
          <span>航班</span>
          <select v-model="teamViewFlight">
            <option value="">全部航班</option>
            <option v-for="flight in flightOptions" :key="flight" :value="flight">{{ flight }}</option>
          </select>
        </label>
        <label class="filter-item checkbox-item">
          <input v-model="weekOnly" type="checkbox" />
          <span>仅看本周</span>
        </label>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>清洁班组</th>
            <th>保障架次</th>
            <th>作业项数（已完成/计划）</th>
            <th>用水量合计（升）</th>
            <th>耗材领用合计（件）</th>
            <th>涉及航班</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in teamSummary" :key="item.team">
            <td>{{ item.team }}</td>
            <td>{{ item.jobs }}</td>
            <td>{{ item.doneItems }}/{{ item.plannedItems }}</td>
            <td>{{ item.waterTotal }}</td>
            <td>{{ item.materialTotal }}</td>
            <td>{{ item.flights.join('、') || '—' }}</td>
          </tr>
          <tr v-if="!teamSummary.length">
            <td colspan="6" class="empty-state">当前范围内没有清洁作业记录</td>
          </tr>
        </tbody>
        <tfoot v-if="teamSummary.length">
          <tr class="subtotal-row">
            <td>合计</td>
            <td>{{ teamViewTotals.jobs }}</td>
            <td>{{ teamViewTotals.doneItems }}/{{ teamViewTotals.plannedItems }}</td>
            <td>{{ teamViewTotals.waterTotal }}</td>
            <td>{{ teamViewTotals.materialTotal }}</td>
            <td>—</td>
          </tr>
        </tfoot>
      </table>

      <section v-if="teamViewFlight" class="drill-section">
        <h3>航班 {{ teamViewFlight }} 作业明细</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>作业编号</th>
              <th>清洁班组</th>
              <th>作业日期</th>
              <th>作业项数（已完成/计划）</th>
              <th>用水量（升）</th>
              <th>耗材领用（件）</th>
              <th>当前状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in flightDetails" :key="String(row.id)">
              <td>{{ row['作业编号'] }}</td>
              <td>{{ row['清洁班组'] }}</td>
              <td>{{ row['作业日期'] }}</td>
              <td>{{ row['已完成项数'] }}/{{ row['作业项数'] }}</td>
              <td>{{ row['用水量'] }}</td>
              <td>{{ row['耗材领用'] }}</td>
              <td>{{ row.status }}</td>
            </tr>
            <tr v-if="!flightDetails.length">
              <td colspan="7" class="empty-state">该航班在当前范围内没有清洁作业</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="drill-section">
        <h3>保障班组耗材领用清单</h3>
        <p class="page-desc">耗材领用按航班挂到对应保障班组，与保障班组页读到的是同一份汇总。</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>保障班组</th>
              <th>在岗人数</th>
              <th>涉及航班</th>
              <th>耗材领用合计（件）</th>
              <th>人均领用（件/人）</th>
              <th>人岗匹配提示</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in materialIssues" :key="item.team" :class="{ 'row-warn': item.warning }">
              <td>{{ item.team }}</td>
              <td>{{ item.onDuty ?? '—' }}</td>
              <td>{{ item.flights.join('、') || '—' }}</td>
              <td>{{ item.materialTotal }}</td>
              <td>{{ item.perCapita === null ? '—' : item.perCapita.toFixed(1) }}</td>
              <td>
                <span v-if="item.warning" class="warn-text">⚠ {{ item.warning }}</span>
                <span v-else>正常</span>
              </td>
            </tr>
            <tr v-if="!materialIssues.length">
              <td colspan="6" class="empty-state">暂无耗材领用记录</td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer class="page-foot">
        <span>项数合计与作业记录同源，均出自同一份清洁作业清单</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  cabinFlights,
  cabinJobDetails,
  cabinTeamSummary,
  materialIssueByTeam,
  runCabinAction,
  sumCabinRows,
  updateCabinProgress,
} from '@/api/cabin-service'
import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('cabin')
const columns = ["作业编号", "航班号", "清洁班组", "作业日期", "作业项数", "已完成项数", "用水量", "耗材领用", "质检人员", "作业状态"]
const actions = ["开始清洁", "提交质检", "确认完成"]
const statuses = ["待清洁", "清洁中", "待质检", "已完成"]
const stats = [{"label": "今日清洁架次", "value": 0}, {"label": "清洁中作业", "value": 0}, {"label": "待质检作业", "value": 0}]

const view = ref<'records' | 'teams'>('records')
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const progressDraft = ref<Record<string, number>>({})

const teamViewFlight = ref('')
const weekOnly = ref(true)
const summaryVersion = ref(0)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const flightOptions = computed(() => {
  summaryVersion.value
  return cabinFlights()
})
const teamSummary = computed(() => {
  summaryVersion.value
  return cabinTeamSummary(teamViewFlight.value, weekOnly.value)
})
const teamViewTotals = computed(() => {
  summaryVersion.value
  return sumCabinRows(cabinJobDetails(teamViewFlight.value, weekOnly.value))
})
const flightDetails = computed(() => {
  summaryVersion.value
  return cabinJobDetails(teamViewFlight.value, weekOnly.value)
})
const materialIssues = computed(() => {
  summaryVersion.value
  return materialIssueByTeam()
})

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
  errorMessage.value = ''
  const result = runCabinAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function saveProgress(row: EntryRow) {
  errorMessage.value = ''
  const draft = progressDraft.value[String(row.id)]
  const result = updateCabinProgress(Number(row.id), Number(draft))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    const drafts: Record<string, number> = {}
    for (const row of payload.items) {
      drafts[String(row.id)] = Number(row['已完成项数']) || 0
    }
    progressDraft.value = drafts
    summaryVersion.value += 1
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '客舱清洁列表读取失败'
  }
}

onMounted(reload)
</script>
