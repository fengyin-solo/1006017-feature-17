/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 为 true 时状态只能按 statuses 顺序逐段推进，不许跳步、不许回退。 */
  enforceSequence?: boolean
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 客舱清洁「班组完成视图」里一个清洁班组的汇总行，全部从清洁作业记录聚合而来。 */
export type CabinTeamSummary = {
  team: string
  jobs: number
  itemTotal: number
  waterTotal: number
  supplyTotal: number
  flights: string[]
}

/** 保障班组领用清单里单个航班的领用明细。 */
export type SupplyFlight = {
  flight: string
  supply: number
}

/** 保障班组的耗材领用汇总：与客舱清洁视图同源，核对不通过时 warning 里写明依据。 */
export type TeamSupplyIssue = {
  team: string
  headcount: number | null
  supplyTotal: number
  flights: SupplyFlight[]
  perPerson: number | null
  quota: number
  warning: string | null
}

/** 班组完成视图下钻到单个航班的明细。 */
export type CabinFlightDetail = {
  team: string
  flight: string
  jobs: EntryRow[]
  supportTeam: string | null
  supply: number
  issue: TeamSupplyIssue | null
}
