import { defineStore } from 'pinia'

// 当前操作成员 id 持久化在本地；被撤销/移除后服务端会返回 401，前端自动回到未登录态
const MEMBER_KEY = 'family_member_id'

async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } }
  const memberId = localStorage.getItem(MEMBER_KEY)
  if (memberId) opt.headers['X-Member-Id'] = memberId
  if (body) opt.body = JSON.stringify(body)
  const r = await fetch('/api' + path, opt)
  const data = await r.json()
  if (!r.ok) {
    const err = new Error(data.error || '请求失败')
    err.status = r.status
    throw err
  }
  return data
}

export const useHomeStore = defineStore('home', {
  state: () => ({
    loaded: false,
    tab: 'dash',
    rooms: [],
    types: [],
    devices: [],
    scenes: [],
    logs: [],
    energy: { total: 0, trend: [], rooms: [], devices: [] },
    alerts: [],
    quotas: [],
    quotaAlerts: [],
    // 家庭共享
    current: null,            // 当前操作成员（含各权限点 perms）；null=未登录/身份失效
    members: [],
    invitations: [],
    toast: null,
    timer: null,
    // 已通知过的定额告警身份签名（id → level:status）：
    // 新建、warn→error 升级、系统自动解除后重开各通知一次；普通读数刷新/降级不重复通知
    alertSig: null
  }),
  getters: {
    onlineCount: (s) => s.devices.filter((d) => d.status === 'online').length,
    errorCount: (s) => s.devices.filter((d) => d.status === 'error').length,
    onCount: (s) => s.devices.filter((d) => d.power_on).length,
    totalWatts: (s) => s.devices.reduce((sum, d) => sum + (d.power_on ? d.watts : 0), 0),
    // 待处理/处理中的定额告警，用于 Tab 角标
    pendingQuotaAlerts: (s) => s.quotaAlerts.filter((a) => a.status === 'open' || a.status === 'handling'),
    activeMembers: (s) => s.members.filter((m) => m.active),
    // 当前成员是否拥有某权限点；未登录一律 false
    can: (s) => (perm) => !!s.current?.perms?.[perm]
  },
  actions: {
    async load() {
      const d = await api('/state')
      const firstLoad = !this.loaded
      this.rooms = d.rooms
      this.types = d.types
      this.devices = d.devices
      this.scenes = d.scenes
      this.logs = d.logs
      this.energy = d.energy
      this.alerts = d.alerts
      this.quotas = d.quotas || []
      this.quotaAlerts = d.quota_alerts || []
      this.members = d.members || []
      this.invitations = d.invitations || []
      // 服务端判定身份失效（撤销/移除）时清除本地选择，回到加入/切换态
      if (!d.current && localStorage.getItem(MEMBER_KEY)) this.switchMember(null)
      this.current = d.current
      this.loaded = true
      this.notifyNewQuotaAlerts(firstLoad)
    },
    // 新触发、预警升级超标、自动解除后重开的定额告警各给一次桌面内通知；
    // 首次加载不打扰；普通用量刷新、级别下调不通知，同一身份不重复弹
    notifyNewQuotaAlerts(firstLoad) {
      const sigOf = (a) => `${a.level}:${a.status}`
      const active = this.quotaAlerts.filter((a) => a.status === 'open' || a.status === 'handling')
      const activeIds = new Set(active.map((a) => a.id))
      if (firstLoad || this.alertSig == null) {
        this.alertSig = new Map(active.map((a) => [a.id, sigOf(a)]))
        if (firstLoad) return
      }
      // 已从活动列表消失（系统自动解除/人工闭环）的告警清除签名，
      // 之后重开才能被识别为「重新进入活动态」
      for (const id of [...this.alertSig.keys()]) {
        if (!activeIds.has(id)) this.alertSig.delete(id)
      }
      for (const a of active) {
        const prev = this.alertSig.get(a.id)
        const cur = sigOf(a)
        if (!prev || prev !== cur) {
          if (!prev) {
            // 新出现的活动告警（含自动解除后同周期重开）
            this.pushQuotaToast(a)
          } else {
            const [prevLevel] = prev.split(':')
            // warn→error 升级才补通知；error→warn 降级与普通状态流转不打扰
            if (prevLevel === 'warn' && a.level === 'error') this.pushQuotaToast(a)
          }
          this.alertSig.set(a.id, cur)
        }
      }
    },
    pushQuotaToast(a) {
      const pct = Math.round((a.used_kwh / a.limit_kwh) * 100)
      this.toastMsg(
        `${a.level === 'error' ? '🚨 超标告警' : '⚠️ 超标预警'}：${a.scope === 'room' ? '房间' : '设备'}「${a.target_name}」${a.period_label}定额已用 ${pct}%`,
        a.level === 'error' ? 'warn' : 'info')
    },
    // 看板趋势/实时用电随模拟节拍轻量刷新；轮询失败静默（手动操作仍会立即拉取）
    startAutoRefresh() {
      if (this.timer) return
      this.timer = setInterval(() => { this.load().catch(() => {}) }, 20_000)
    },
    toastMsg(msg, type = 'info') {
      this.toast = { msg, type, id: Date.now() }
    },
    clearToast() { this.toast = null },

    // ===== 家庭共享：身份 / 邀请 / 成员 =====
    switchMember(id) {
      if (id) localStorage.setItem(MEMBER_KEY, String(id))
      else localStorage.removeItem(MEMBER_KEY)
      this.current = null
    },
    // 统一样板：401（授权被回收）时清身份并提示，403（角色不足）给明确提示
    async callWithGuard(fn) {
      try { return await fn() }
      catch (e) {
        if (e.status === 401) {
          this.switchMember(null)
          await this.load().catch(() => {})
        }
        this.toastMsg(e.message, 'warn')
        return null
      }
    },
    async createInvite(form) {
      return this.callWithGuard(async () => {
        await api('/invitations', 'POST', { role: form.role, note: form.note || '' })
        await this.load()
        this.toastMsg('邀请已创建，请把邀请码发给对方', 'success')
        return true
      })
    },
    async acceptInvite(code, name) {
      // 加入前调用：不依赖当前身份
      try {
        const r = await api('/invitations/accept', 'POST', { code, name })
        this.switchMember(r.member.id)
        await this.load()
        this.toastMsg(`欢迎加入家庭，当前角色：${this.current.role_label}`, 'success')
        return true
      } catch (e) { this.toastMsg(e.message, 'warn'); return false }
    },
    async revokeInvite(id) {
      return this.callWithGuard(async () => {
        await api(`/invitations/${id}/revoke`, 'POST')
        await this.load()
        this.toastMsg('邀请已撤销，对方授权即刻回收', 'success')
        return true
      })
    },
    async reopenInvite(id, role) {
      return this.callWithGuard(async () => {
        await api(`/invitations/${id}/reopen`, 'POST', { role })
        await this.load()
        this.toastMsg('邀请已重新生效', 'success')
        return true
      })
    },
    async changeMemberRole(id, role) {
      return this.callWithGuard(async () => {
        await api(`/members/${id}/role`, 'POST', { role })
        await this.load()
        this.toastMsg('成员角色已调整', 'success')
        return true
      })
    },
    async removeMember(id) {
      return this.callWithGuard(async () => {
        await api(`/members/${id}/remove`, 'POST')
        await this.load()
        this.toastMsg('成员已移除，授权即刻回收', 'success')
        return true
      })
    },

    async addDevice(p) {
      return this.callWithGuard(async () => {
        await api('/device', 'POST', p); await this.load(); this.toastMsg('已新增设备', 'success'); return true
      })
    },
    async removeDevice(id) {
      const r = await this.callWithGuard(() => api('/device/' + id, 'DELETE'))
      if (r) await this.load()
    },
    async toggleDevice(id) {
      try {
        const r = await api(`/device/${id}/toggle`, 'POST'); await this.load()
        return r.power_on
      } catch (e) {
        if (e.status === 401) { this.switchMember(null); await this.load().catch(() => {}) }
        this.toastMsg(e.message, 'warn')
      }
    },
    async updateDevice(id, patch) {
      const r = await this.callWithGuard(() => api(`/device/${id}/update`, 'POST', patch))
      if (r) await this.load()
    },
    async addScene(scene) {
      return this.callWithGuard(async () => {
        const r = await api('/scene', 'POST', scene); await this.load()
        this.toastMsg('场景已创建', 'success'); return r.id
      })
    },
    async deleteScene(id) {
      const r = await this.callWithGuard(() => api('/scene/' + id, 'DELETE'))
      if (r) await this.load()
    },
    async toggleScene(id) {
      const r = await this.callWithGuard(() => api(`/scene/${id}/toggle`, 'POST'))
      if (r) await this.load()
    },
    async runScene(id) {
      try {
        const r = await api(`/scene/${id}/run`, 'POST')
        await this.load()
        if (r.failed?.length)
          this.toastMsg(`场景执行完成：成功 ${r.executed.length} 项，失败 ${r.failed.length} 项`, 'warn')
        else
          this.toastMsg(`场景已触发，成功执行 ${r.executed.length} 个动作`, 'success')
        return r
      } catch (e) {
        if (e.status === 401) { this.switchMember(null); await this.load().catch(() => {}) }
        this.toastMsg(e.message, 'warn')
      }
    },

    // ===== 能耗定额闭环 =====
    async saveQuota(form) {
      return this.callWithGuard(async () => {
        if (form.id) {
          await api(`/quota/${form.id}/update`, 'POST', {
            limit_kwh: Number(form.limit_kwh), period: form.period,
            enabled: form.enabled, reason: form.reason || ''
          })
          this.toastMsg('定额已调整并记录留痕', 'success')
        } else {
          await api('/quota', 'POST', {
            scope: form.scope,
            room_id: form.scope === 'room' ? Number(form.room_id) : null,
            device_id: form.scope === 'device' ? Number(form.device_id) : null,
            period: form.period, limit_kwh: Number(form.limit_kwh),
            reason: form.reason || ''
          })
          this.toastMsg('定额已创建', 'success')
        }
        await this.load()
        return true
      })
    },
    async toggleQuota(q) {
      const r = await this.callWithGuard(() => api(`/quota/${q.id}/update`, 'POST', { enabled: !q.enabled }))
      if (r) await this.load()
    },
    async removeQuota(id) {
      const r = await this.callWithGuard(() => api('/quota/' + id, 'DELETE'))
      if (r) { await this.load(); this.toastMsg('定额已删除', 'success') }
    },
    async handleQuotaAlert(id, patch) {
      const r = await this.callWithGuard(async () => {
        await api(`/quota-alert/${id}/handle`, 'POST', patch)
        await this.load()
        this.toastMsg('告警状态已更新', 'success')
        return true
      })
      return r
    },
    async fetchAdjustments(quotaId = null) {
      const qs = quotaId ? `?quota_id=${quotaId}` : ''
      return await api('/quota-adjustments' + qs)
    }
  }
})
