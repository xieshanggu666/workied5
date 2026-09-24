<template>
  <div class="family">
    <!-- 当前身份 -->
    <div class="card identity">
      <template v-if="store.current">
        <div class="me">
          <span class="avatar" :class="store.current.role">{{ initial(store.current.name) }}</span>
          <div class="me-info">
            <b>{{ store.current.name }}</b>
            <span class="role-tag" :class="store.current.role">{{ store.current.role_label }}</span>
          </div>
        </div>
        <ul class="perm-list">
          <li v-for="p in permSummary" :key="p.k" :class="{ yes: p.v, no: !p.v }">
            <span>{{ p.v ? '✓' : '×' }}</span>{{ p.t }}
          </li>
        </ul>
        <button class="ghost" @click="store.switchMember(null); store.load()">切换身份</button>
      </template>
      <template v-else>
        <div class="join">
          <h4>👋 加入或切换家庭身份</h4>
          <p class="hint">这是一个纯演示环境：可直接选择一位成员进入，或凭邀请码以新成员身份加入。</p>
          <div class="join-cols">
            <div class="join-box">
              <b>选择成员进入</b>
              <div class="pick">
                <button v-for="m in store.activeMembers" :key="m.id" class="pick-btn" @click="pick(m)">
                  <span class="avatar sm" :class="m.role">{{ initial(m.name) }}</span>
                  {{ m.name }}<em>{{ m.role_label }}</em>
                </button>
              </div>
            </div>
            <form class="join-box" @submit.prevent="doAccept">
              <b>凭邀请码加入</b>
              <input v-model="joinCode" placeholder="邀请码，如 FAMILY2026" required />
              <input v-model="joinName" placeholder="你的称呼，如 爷爷" required />
              <button class="save" type="submit">接受邀请并加入</button>
            </form>
          </div>
        </div>
      </template>
    </div>

    <template v-if="store.current">
      <!-- 邀请管理 -->
      <div class="card">
        <div class="card-head">
          <h4>✉️ 邀请管理 · 创建 / 接受 / 撤销 / 重新邀请</h4>
        </div>

        <form v-if="store.can('member_invite')" class="inv-form" @submit.prevent="doCreateInvite">
          <select v-model="invForm.role">
            <option value="admin">管理员（可管设备、场景、定额与成员）</option>
            <option value="member">成员（可控设备、执行场景、处理告警）</option>
            <option value="guest">访客（仅查看）</option>
          </select>
          <input v-model="invForm.note" placeholder="备注，如 周末来住的朋友（可选）" />
          <button class="save" type="submit">＋ 创建邀请</button>
        </form>

        <table v-if="store.invitations.length">
          <thead><tr>
            <th>邀请码</th><th>授予角色</th><th>状态</th><th>邀请人 / 接受人</th>
            <th>备注</th><th>时间</th><th>操作</th>
          </tr></thead>
          <tbody>
            <tr v-for="i in store.invitations" :key="i.id">
              <td><code class="inv-code">{{ i.code }}</code></td>
              <td><span class="role-tag" :class="i.role">{{ i.role_label }}</span></td>
              <td><span class="inv-st" :class="i.status">{{ i.status_label }}</span></td>
              <td>
                {{ i.inviter_name || '—' }}
                <template v-if="i.invitee_name"> → <b>{{ i.invitee_name }}</b></template>
              </td>
              <td class="dim">{{ i.note || '—' }}</td>
              <td class="dim">{{ fmtTime(i.revoked_at || i.accepted_at || i.created_at) }}</td>
              <td class="ops">
                <button v-if="i.status!=='revoked' && store.can('invite_revoke')"
                        class="danger" @click="doRevoke(i)">撤销</button>
                <button v-if="i.status==='revoked' && store.can('invite_reopen')"
                        class="ok-btn" @click="doReopen(i)">重新邀请</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">暂无邀请。</div>
        <p class="sub">撤销已接受的邀请会同时停用对应成员，其设备控制、场景执行与告警处理授权即刻失效；「重新邀请」可原地恢复（可回收的协作闭环）。</p>
      </div>

      <!-- 成员与角色权限 -->
      <div class="card">
        <div class="card-head"><h4>👨‍👩‍👧‍👦 家庭成员与角色权限</h4></div>
        <table>
          <thead><tr><th>成员</th><th>角色</th><th>状态</th><th>加入时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="m in store.members" :key="m.id" :class="{inactive:!m.active}">
              <td>
                <span class="avatar sm" :class="m.active ? m.role : 'revoked'">{{ initial(m.name) }}</span>
                <b>{{ m.name }}</b>
                <em v-if="m.id===store.current.id" class="me-flag">当前是我</em>
              </td>
              <td>
                <template v-if="m.role==='owner' || !m.active || !store.can('member_role')">
                  <span class="role-tag" :class="m.active ? m.role : 'revoked'">{{ m.role_label }}</span>
                </template>
                <select v-else :value="m.role" @change="changeRole(m, $event.target.value)">
                  <option value="admin">管理员</option>
                  <option value="member">成员</option>
                  <option value="guest">访客</option>
                </select>
              </td>
              <td>
                <span class="mem-st" :class="m.active ? 'active' : 'inactive'">
                  {{ m.active ? '授权有效' : '已停用 · 授权回收' }}
                </span>
              </td>
              <td class="dim">{{ fmtTime(m.created_at) }}</td>
              <td class="ops">
                <button v-if="canRemove(m)" class="danger" @click="doRemove(m)">移除</button>
                <span v-else class="dim">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="sub">
          权限范围：<b>户主</b> 全部权限；<b>管理员</b> 可管理设备/场景/定额与邀请；
          <b>成员</b> 可控制设备、执行场景、处理定额告警；<b>访客</b> 仅查看。
          成员的每一步操作（含接受邀请、撤销、角色调整）都会写入家庭日志时间线。
        </p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useHomeStore } from '@/store/home'
const store = useHomeStore()

const joinCode = ref('FAMILY2026')
const joinName = ref('')
const invForm = ref({ role: 'guest', note: '' })

const PERM_TEXTS = [
  ['device_control', '设备开关控制'],
  ['scene_run', '场景执行'],
  ['quota_alert_handle', '定额告警处理'],
  ['device_update', '设备配置变更'],
  ['quota_manage', '定额配置管理'],
  ['member_invite', '邀请与成员管理']
]
const permSummary = computed(() =>
  PERM_TEXTS.map(([k, t]) => ({ k, t, v: store.can(k) })))

function initial(name) { return [...(name || '?')][0] }
async function pick(m) {
  store.switchMember(m.id)
  await store.load()
  store.toastMsg(`已切换为「${m.name}」（${m.role_label}）`, 'success')
}
async function doAccept() {
  const ok = await store.acceptInvite(joinCode.value.trim(), joinName.value.trim())
  if (ok) { joinCode.value = ''; joinName.value = '' }
}
async function doCreateInvite() {
  const ok = await store.createInvite(invForm.value)
  if (ok) invForm.value = { role: 'guest', note: '' }
}
async function doRevoke(i) {
  if (confirm(`撤销邀请 ${i.code}？` + (i.member_id ? `\n成员「${i.invitee_name}」的授权将立即回收。` : '\n该邀请尚未被接受。')))
    await store.revokeInvite(i.id)
}
async function doReopen(i) {
  const role = i.role === 'admin' || i.role === 'member' || i.role === 'guest' ? i.role : 'guest'
  await store.reopenInvite(i.id, role)
}
async function changeRole(m, role) {
  if (role !== m.role) await store.changeMemberRole(m.id, role)
}
async function doRemove(m) {
  if (confirm(`移除成员「${m.name}」？\n其邀请将一并撤销，授权立即回收。`)) await store.removeMember(m.id)
}
// 户主可移除任何人（除自己与户主）；管理员仅可移除成员/访客
function canRemove(m) {
  if (!m.active || m.role === 'owner' || m.id === store.current.id) return false
  if (store.current.role === 'owner') return true
  return store.can('member_remove') && (m.role === 'member' || m.role === 'guest')
}
function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<style scoped>
.family{display:flex;flex-direction:column;gap:16px;}
.card{background:#0f1b38;border:1px solid rgba(120,160,220,0.16);border-radius:12px;padding:16px;}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
h4{margin:0;color:#fff;font-size:14px;}

/* 身份卡 */
.identity{display:flex;align-items:center;gap:18px;flex-wrap:wrap;}
.me{display:flex;align-items:center;gap:12px;min-width:200px;}
.avatar{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;font-size:19px;font-weight:700;color:#fff;flex:none;}
.avatar.sm{width:30px;height:30px;font-size:13px;margin-right:6px;vertical-align:middle;}
.avatar.owner{background:linear-gradient(135deg,#ffb300,#f57c00);}
.avatar.admin{background:linear-gradient(135deg,#42a5f5,#1565c0);}
.avatar.member{background:linear-gradient(135deg,#66bb6a,#2e7d32);}
.avatar.guest{background:linear-gradient(135deg,#78909c,#455a64);}
.avatar.revoked{background:#37474f;}
.me-info b{display:block;color:#fff;font-size:16px;}
.role-tag{font-style:normal;font-size:11px;padding:2px 9px;border-radius:20px;font-weight:600;}
.role-tag.owner{background:#4e3410;color:#ffcc80;}
.role-tag.admin{background:#13315c;color:#90caf9;}
.role-tag.member{background:#1b3a1f;color:#a5d6a7;}
.role-tag.guest{background:#263238;color:#b0bec5;}
.role-tag.revoked{background:#4a1818;color:#ff8a80;}
.perm-list{list-style:none;display:flex;gap:8px;flex-wrap:wrap;margin:0;padding:0;flex:1;min-width:280px;}
.perm-list li{font-size:11px;padding:4px 10px;border-radius:20px;border:1px solid;}
.perm-list li.yes{color:#a5d6a7;border-color:rgba(102,187,106,.35);background:rgba(102,187,106,.08);}
.perm-list li.no{color:#6f84ab;border-color:rgba(120,160,220,.15);background:#0c1730;}

/* 加入面板 */
.join h4{font-size:15px;margin-bottom:6px;}
.hint{color:#8ba2c8;font-size:12px;margin:0 0 12px;}
.join-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;}
.join-box{background:#0c1730;border:1px solid rgba(120,160,220,0.16);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:9px;}
.join-box b{color:#dbe4f3;font-size:13px;}
.pick{display:flex;flex-direction:column;gap:7px;}
.pick-btn{display:flex;align-items:center;gap:4px;text-align:left;background:#13233f;border:1px solid rgba(120,160,220,0.2);color:#dbe4f3;border-radius:8px;padding:8px 10px;font-size:12px;cursor:pointer;}
.pick-btn:hover{border-color:#2962ff;}
.pick-btn em{font-style:normal;margin-left:auto;font-size:10px;color:#8ba2c8;}

select,input,button{font-family:inherit;background:#13233f;border:1px solid rgba(120,160,220,0.2);color:#dbe4f3;border-radius:8px;padding:8px 10px;font-size:12px;}
.save{background:#2962ff;border:none;color:#fff;cursor:pointer;font-weight:600;}
.ghost{background:#16263f;color:#8ba2c8;cursor:pointer;}

.inv-form{display:flex;gap:8px;flex-wrap:wrap;background:#0c1730;border:1px solid rgba(120,160,220,0.18);border-radius:10px;padding:12px;margin-bottom:12px;}
.inv-form select{flex:1;min-width:220px;}
.inv-form input{flex:1;min-width:180px;}

table{width:100%;border-collapse:collapse;font-size:12px;}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid rgba(120,160,220,0.1);vertical-align:middle;}
th{color:#8ba2c8;font-weight:600;font-size:11px;}
td{color:#dbe4f3;}
tr.inactive{opacity:.55;}
.inv-code{background:#13233f;border:1px solid rgba(120,160,220,0.25);border-radius:6px;padding:2px 8px;font-size:11px;color:#90caf9;letter-spacing:.5px;}
.inv-st{font-style:normal;font-size:10px;padding:2px 8px;border-radius:6px;}
.inv-st.pending{background:#4e3410;color:#ffcc80;}
.inv-st.accepted{background:#1b3a1f;color:#a5d6a7;}
.inv-st.revoked{background:#4a1818;color:#ff8a80;}
.mem-st{font-style:normal;font-size:10px;padding:2px 8px;border-radius:6px;}
.mem-st.active{background:#1b3a1f;color:#a5d6a7;}
.mem-st.inactive{background:#4a1818;color:#ff8a80;}
.me-flag{font-style:normal;font-size:10px;color:#ffd54f;margin-left:8px;}
.dim{color:#5b6f94;font-size:11px;}
.ops{white-space:nowrap;}
.ops button{padding:4px 10px;cursor:pointer;font-size:11px;}
.ops .danger{color:#ef5350;border-color:rgba(239,83,80,.4);}
.ops .ok-btn{color:#a5d6a7;border-color:rgba(102,187,106,.4);}
.empty{color:#5b6f94;text-align:center;padding:14px;font-size:12px;}
.sub{margin:10px 0 0;font-size:11px;color:#5b6f94;line-height:1.7;}
.sub b{color:#8ba2c8;font-weight:600;}
</style>
