<template>
  <div class="layout">
    <header class="top">
      <div class="brand"><span class="logo">🏠</span><div><b>智居</b><em>Smart Home</em></div></div>
      <nav class="tabs">
        <button v-for="t in tabs" :key="t.key" :class="{active:store.tab===t.key}" @click="store.tab=t.key">
          {{ t.icon }} {{ t.label }}<span v-if="t.badge && t.badge()" class="bd">{{ t.badge() }}</span>
        </button>
      </nav>
      <div class="actor" @click="store.tab='family'">
        <template v-if="store.current">
          <span class="a-avatar" :class="store.current.role">{{ [...store.current.name][0] }}</span>
          <span class="a-name">{{ store.current.name }}</span>
          <span class="a-role">{{ store.current.role_label }}</span>
        </template>
        <template v-else>
          <span class="a-avatar guest">?</span>
          <span class="a-join">加入家庭 / 切换身份</span>
        </template>
      </div>
      <button class="reload" @click="store.load()">🔄</button>
    </header>

    <main>
      <div v-if="store.loaded && !store.current && store.tab!=='family'" class="join-banner" @click="store.tab='family'">
        👋 尚未选择家庭成员：当前为只读浏览。<b>点击加入或切换身份 →</b>
      </div>
      <DashboardView v-if="store.tab==='dash'" />
      <DevicesView v-else-if="store.tab==='devices'" />
      <ScenesView v-else-if="store.tab==='scenes'" />
      <EnergyView v-else-if="store.tab==='energy'" />
      <QuotaView v-else-if="store.tab==='quota'" />
      <FamilyView v-else-if="store.tab==='family'" />
      <LogsView v-else-if="store.tab==='logs'" />
    </main>

    <transition name="tg">
      <div v-if="store.toast" class="toast" :class="store.toast.type" @click="store.clearToast()">{{ store.toast.msg }}</div>
    </transition>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useHomeStore } from '@/store/home'
import DashboardView from '@/components/DashboardView.vue'
import DevicesView from '@/components/DevicesView.vue'
import ScenesView from '@/components/ScenesView.vue'
import EnergyView from '@/components/EnergyView.vue'
import QuotaView from '@/components/QuotaView.vue'
import FamilyView from '@/components/FamilyView.vue'
import LogsView from '@/components/LogsView.vue'

const store = useHomeStore()
const tabs = [
  { key: 'dash', icon: '📊', label: '健康看板', badge: () => store.alerts.length || 0 },
  { key: 'devices', icon: '📟', label: '设备管理' },
  { key: 'scenes', icon: '🎬', label: '场景联动' },
  { key: 'energy', icon: '⚡', label: '能耗统计' },
  { key: 'quota', icon: '📏', label: '能耗定额', badge: () => store.pendingQuotaAlerts.length || 0 },
  { key: 'family', icon: '👪', label: '家庭共享', badge: () => (store.invitations || []).filter((i) => i.status === 'pending').length || null },
  { key: 'logs', icon: '📜', label: '日志' }
]
onMounted(async () => {
  try { await store.load(); store.startAutoRefresh() }
  catch (e) { store.toastMsg('后端未启动，请运行 node server/index.js', 'warn') }
})
</script>

<style scoped>
.layout{min-height:100vh;background:#0a1224;color:#dbe4f3;padding-bottom:40px;}
.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:16px;padding:10px 20px;background:#0c1730;border-bottom:1px solid rgba(120,160,220,0.18);flex-wrap:wrap;}
.brand{display:flex;align-items:center;gap:8px;}
.logo{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;font-size:20px;background:linear-gradient(135deg,#42a5f5,#1565c0);}
.brand b{color:#fff;font-size:15px;display:block;}
.brand em{font-size:10px;color:#6f84ab;font-style:normal;letter-spacing:1px;}
.tabs{display:flex;gap:6px;flex-wrap:wrap;}
.tabs button{background:#13233f;border:1px solid rgba(120,160,220,0.2);color:#aebadd;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;position:relative;}
.tabs button.active{background:linear-gradient(135deg,#1d3f8f,#2962ff);color:#fff;border-color:transparent;}
.bd{position:absolute;top:-4px;right:-4px;background:#ef5350;color:#fff;font-size:9px;border-radius:8px;padding:1px 5px;font-weight:700;}
.actor{display:flex;align-items:center;gap:7px;background:#13233f;border:1px solid rgba(120,160,220,0.3);border-radius:20px;padding:4px 12px 4px 5px;cursor:pointer;font-size:12px;margin-left:auto;}
.actor:hover{border-color:#2962ff;}
.a-avatar{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:700;color:#fff;}
.a-avatar.owner{background:linear-gradient(135deg,#ffb300,#f57c00);}
.a-avatar.admin{background:linear-gradient(135deg,#42a5f5,#1565c0);}
.a-avatar.member{background:linear-gradient(135deg,#66bb6a,#2e7d32);}
.a-avatar.guest{background:linear-gradient(135deg,#78909c,#455a64);}
.a-name{color:#dbe4f3;font-weight:600;}
.a-role{color:#8ba2c8;font-size:10px;}
.a-join{color:#ffd54f;font-size:11px;}
.reload{margin-left:auto;background:#13233f;border:1px solid rgba(120,160,220,0.3);border-radius:8px;color:#8ba2c8;font-size:16px;cursor:pointer;padding:4px 10px;}
main{max-width:1240px;margin:0 auto;padding:18px 20px;}
.join-banner{margin-bottom:14px;background:linear-gradient(135deg,#4e3410,#3a2f12);border:1px solid rgba(255,202,40,0.45);color:#ffd54f;border-radius:10px;padding:10px 16px;font-size:12px;cursor:pointer;}
.join-banner b{margin-left:6px;}
.toast{position:fixed;right:20px;top:70px;z-index:50;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.4);cursor:pointer;}
.toast.success{background:#1b5e20;color:#c8e6c9;border:1px solid #388e3c;}
.toast.warn{background:#e65100;color:#ffe0b2;border:1px solid #f57c00;}
.toast.info{background:#0d47a1;color:#bbdefb;border:1px solid #1976d2;}
.tg-enter-active,.tg-leave-active{transition:all .3s;}
.tg-enter-from,.tg-leave-to{opacity:0;transform:translateY(-10px);}
</style>