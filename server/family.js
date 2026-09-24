// ===== 家庭共享管理：成员 / 邀请 / 角色权限 / 撤销状态 =====
//
// 成员角色（自上而下逐级收窄）：
//   owner   户主：全部权限，且是唯一能调整/移除管理员与其他成员角色的人
//   admin   管理员：设备/场景/定额/告警全部可操作，可邀请成员、撤销邀请、移除 guest/member
//   member  家庭成员：可控制设备、执行场景、处理定额告警，但不能改配置与人员
//   guest   访客：只读，可查看看板与日志，不能产生任何写操作
//
// 邀请闭环：创建邀请(pending) → 接受(accepted，自动建成员) → 可随时撤销(revoked)；
// 已撤销邀请的接受方立刻失去授权（其成员账号一并停用），停用后再次越线的操作一律 403；
// 已撤销邀请支持「重新邀请」（同码原地复活），形成可回收的协作闭环。
//
// 授权范围贯穿三类写操作：设备控制、场景执行、定额告警处理（见 PERMS / can）。
// 所有成员写操作由调用方记入家庭日志（device_logs，携带操作人快照）。

import { randomBytes } from 'node:crypto'

// 角色等级：数值越大权限越高；revoked 仅用于已停用成员，等级为 -1 等同于无权限
export const ROLE_LEVEL = { owner: 4, admin: 3, member: 2, guest: 1, revoked: -1 }
export const ROLE_LABEL = { owner: '户主', admin: '管理员', member: '成员', guest: '访客', revoked: '已停用' }

// 权限点 → 最低可操作角色。未列出的动作（看板/日志/状态查询等）所有有效成员均可只读访问
export const PERMS = {
  device_create: 'admin',       // 新增设备
  device_update: 'admin',       // 改名/换房/改功率（结构性变更）
  device_delete: 'admin',       // 删除设备
  device_control: 'member',     // 设备开关控制（访客不可）
  scene_create: 'admin',
  scene_delete: 'admin',
  scene_toggle: 'admin',        // 启用/停用场景
  scene_run: 'member',          // 执行场景（访客不可）
  quota_manage: 'admin',        // 定额增改删/启停
  quota_alert_handle: 'member', // 定额告警处理闭环（开始处理/已处理/忽略/重开）
  member_invite: 'admin',       // 创建邀请
  invite_revoke: 'admin',       // 撤销邀请
  invite_reopen: 'admin',       // 重新邀请（复活已撤销邀请）
  member_remove: 'admin',       // 移除成员（admin 只能移除 member/guest）
  member_role: 'owner'          // 调整成员角色（仅户主）
}

const INVITE_STATUS_LABEL = { pending: '待接受', accepted: '已接受', revoked: '已撤销' }

let db
let stmts

export function initFamily(database) {
  db = database
  db.exec(`
  CREATE TABLE IF NOT EXISTS family_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'guest',      -- owner / admin / member / guest / revoked
    invite_id INTEGER,                        -- 经由哪条邀请加入（户主为空）
    active INTEGER NOT NULL DEFAULT 1,       -- 0=随邀请撤销/被移除而停用
    created_at TEXT NOT NULL,
    deactivated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS family_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,               -- 邀请码
    inviter_id INTEGER,                      -- 邀请人（family_members.id）
    role TEXT NOT NULL DEFAULT 'guest',      -- 接受后获得的角色
    status TEXT NOT NULL DEFAULT 'pending',  -- pending / accepted / revoked
    invitee_name TEXT NOT NULL DEFAULT '',   -- 接受后绑定的成员名快照
    member_id INTEGER,                       -- 接受后创建的成员 id（撤销即停用该成员）
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    accepted_at TEXT,
    revoked_at TEXT,
    reopened_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_family_invitations_status ON family_invitations(status);
  `)
  stmts = {
    memberById: db.prepare('SELECT * FROM family_members WHERE id=?'),
    memberByName: db.prepare('SELECT * FROM family_members WHERE name=?'),
    activeMembers: db.prepare('SELECT * FROM family_members WHERE active=1 ORDER BY CASE role WHEN \'owner\' THEN 0 WHEN \'admin\' THEN 1 WHEN \'member\' THEN 2 ELSE 3 END, id'),
    allMembers: db.prepare('SELECT * FROM family_members ORDER BY active DESC, id'),
    insertMember: db.prepare(`INSERT INTO family_members (name,role,invite_id,active,created_at)
                              VALUES (?,?,?,1,?)`),
    updateRole: db.prepare('UPDATE family_members SET role=? WHERE id=?'),
    deactivateMember: db.prepare('UPDATE family_members SET active=0,role=\'revoked\',deactivated_at=? WHERE id=?'),
    reactivateMember: db.prepare('UPDATE family_members SET active=1,role=?,deactivated_at=NULL WHERE id=?'),
    inviteById: db.prepare('SELECT * FROM family_invitations WHERE id=?'),
    inviteByCode: db.prepare('SELECT * FROM family_invitations WHERE code=?'),
    insertInvite: db.prepare(`INSERT INTO family_invitations (code,inviter_id,role,status,note,created_at)
                              VALUES (?,?,?,'pending',?,?)`),
    allInvites: db.prepare('SELECT * FROM family_invitations ORDER BY id DESC'),
    acceptInvite: db.prepare(`UPDATE family_invitations
                              SET status='accepted',invitee_name=?,member_id=?,accepted_at=? WHERE id=?`),
    revokeInvite: db.prepare(`UPDATE family_invitations SET status='revoked',revoked_at=? WHERE id=?`),
    reopenInvite: db.prepare(`UPDATE family_invitations SET status='pending',revoked_at=NULL,reopened_at=? WHERE id=?`)
  }
  seedMembers()
}

// 权限判定：成员有效（active=1）且角色等级达到动作要求
export function can(member, action) {
  if (!member || !member.active) return false
  const need = PERMS[action]
  if (!need) return true
  return (ROLE_LEVEL[member.role] ?? -1) >= (ROLE_LEVEL[need] ?? 99)
}

// 从请求头 X-Member-Id 解析当前操作人；无效/缺失时返回 null（按无权限处理）
export function resolveActor(memberId) {
  if (memberId == null || memberId === '') return null
  const m = stmts?.memberById.get(Number(memberId))
  return m && m.active ? m : null
}

function genCode() {
  // 8 位 URL 安全邀请码（约 48bit 随机），碰撞则重 roll
  return randomBytes(6).toString('base64url')
}

// ===== 邀请生命周期 =====
export function createInvitation({ role, note = '' }, inviter) {
  if (!['admin', 'member', 'guest'].includes(role))
    throw new Error('邀请角色无效（仅可邀请 管理员/成员/访客）')
  const at = new Date().toISOString()
  let code, tries = 0
  do {
    code = genCode()
    if (++tries > 5) throw new Error('邀请码生成失败，请重试')
  } while (stmts.inviteByCode.get(code))
  const r = stmts.insertInvite.run(code, inviter?.id ?? null, role, note, at)
  return stmts.inviteById.get(r.lastInsertRowid)
}

// 接受邀请：pending → accepted，并创建对应角色的成员（一次性，不接受重复接受）
export function acceptInvitation(code, name) {
  const invite = stmts.inviteByCode.get(String(code || '').trim())
  if (!invite) throw new Error('邀请码无效')
  if (invite.status === 'accepted') throw new Error('该邀请已被接受')
  if (invite.status === 'revoked') throw new Error('该邀请已被撤销')
  const memberName = String(name || '').trim()
  if (!memberName) throw new Error('请填写成员名称')
  if (stmts.memberByName.get(memberName)) throw new Error('已存在同名成员，请换个名称')

  const at = new Date().toISOString()
  const r = stmts.insertMember.run(memberName, invite.role, invite.id, at)
  stmts.acceptInvite.run(memberName, r.lastInsertRowid, at, invite.id)
  return { member: stmts.memberById.get(r.lastInsertRowid), invite: stmts.inviteById.get(invite.id) }
}

// 撤销邀请：pending 邀请直接作废；已接受的邀请在作废同时停用其成员，授权即时回收
export function revokeInvitation(id) {
  const invite = stmts.inviteById.get(Number(id))
  if (!invite) throw new Error('邀请不存在')
  if (invite.status === 'revoked') throw new Error('邀请已处于撤销状态')
  const at = new Date().toISOString()
  stmts.revokeInvite.run(at, invite.id)
  let member = null
  if (invite.member_id) {
    stmts.deactivateMember.run(at, invite.member_id)
    member = stmts.memberById.get(invite.member_id)
  }
  return { invite: stmts.inviteById.get(invite.id), member }
}

// 重新邀请：已撤销邀请原地复活（保留原邀请码与历史）；其成员若仍在则一并恢复角色
export function reopenInvitation(id, role) {
  const invite = stmts.inviteById.get(Number(id))
  if (!invite) throw new Error('邀请不存在')
  if (invite.status !== 'revoked') throw new Error('仅已撤销的邀请可以重新邀请')
  const nextRole = role && ['admin', 'member', 'guest'].includes(role) ? role : invite.role
  const at = new Date().toISOString()
  stmts.reopenInvite.run(at, invite.id)
  let member = null
  if (invite.member_id) {
    stmts.reactivateMember.run(nextRole, invite.member_id)
    member = stmts.memberById.get(invite.member_id)
  }
  return { invite: stmts.inviteById.get(invite.id), member }
}

// ===== 成员管理 =====
export function removeMember(id, actor) {
  const m = stmts.memberById.get(Number(id))
  if (!m) throw new Error('成员不存在')
  if (m.role === 'owner') throw new Error('户主不可移除')
  if (m.id === actor.id) throw new Error('不能移除自己')
  // 管理员只能移除成员/访客；移除管理员须户主
  if (m.role === 'admin' && actor.role !== 'owner')
    throw new Error('仅户主可移除管理员')
  const at = new Date().toISOString()
  const prevRole = m.role
  stmts.deactivateMember.run(at, m.id)
  // 同步撤销其来源邀请，邀请状态与成员授权保持一致，不留「成员没了但邀请仍有效」的口子
  if (m.invite_id) {
    const inv = stmts.inviteById.get(m.invite_id)
    if (inv && inv.status === 'accepted') stmts.revokeInvite.run(at, inv.id)
  }
  return { ...stmts.memberById.get(m.id), prev_role: prevRole }
}

export function changeMemberRole(id, role, actor) {
  const m = stmts.memberById.get(Number(id))
  if (!m || !m.active) throw new Error('成员不存在或已停用')
  if (m.role === 'owner') throw new Error('户主角色不可变更')
  if (!['admin', 'member', 'guest'].includes(role)) throw new Error('目标角色无效')
  if (actor.role !== 'owner') throw new Error('仅户主可调整成员角色')
  stmts.updateRole.run(role, m.id)
  return stmts.memberById.get(m.id)
}

// ===== 序列化视图 =====
export function listMembers() {
  return stmts.allMembers.all().map(viewMember)
}
export function activeMembers() {
  return stmts.activeMembers.all().map(viewMember)
}
function viewMember(m) {
  return {
    id: m.id, name: m.name, role: m.role, role_label: ROLE_LABEL[m.role] || m.role,
    active: !!m.active, invite_id: m.invite_id,
    created_at: m.created_at, deactivated_at: m.deactivated_at
  }
}

export function listInvitations() {
  return stmts.allInvites.all().map((i) => ({
    id: i.id, code: i.code, role: i.role, role_label: ROLE_LABEL[i.role] || i.role,
    status: i.status, status_label: INVITE_STATUS_LABEL[i.status] || i.status,
    inviter_id: i.inviter_id,
    inviter_name: stmts.memberById.get(i.inviter_id)?.name || '',
    invitee_name: i.invitee_name, member_id: i.member_id, note: i.note,
    created_at: i.created_at, accepted_at: i.accepted_at,
    revoked_at: i.revoked_at, reopened_at: i.reopened_at
  }))
}

// 当前请求操作人（含其可用权限点），供前端按角色渲染按钮/开关
export function currentView(memberId) {
  const m = resolveActor(memberId)
  if (!m) return null
  return { ...viewMember(m), perms: Object.fromEntries(Object.keys(PERMS).map((k) => [k, can(m, k)])) }
}

// ===== 首次启动演示数据：一个户主 + 各角色成员 + 一条待接受邀请 =====
function seedMembers() {
  if (stmts.allMembers.all().length > 0) return
  const at = new Date().toISOString()
  const ownerId = stmts.insertMember.run('我（户主）', 'owner', null, at).lastInsertRowid
  stmts.insertMember.run('妈妈', 'admin', null, at)
  stmts.insertMember.run('爸爸', 'member', null, at)
  stmts.insertMember.run('保洁阿姨', 'guest', null, at)
  // 已接受后又撤销的邀请：演示「撤销即回收授权」与时间线留痕
  const inv1 = stmts.insertInvite.run('GUEST-DEMO01', ownerId, 'guest', '每周保洁临时访问', at).lastInsertRowid
  const mid = stmts.insertMember.run('访客·临时', 'guest', inv1, at).lastInsertRowid
  stmts.acceptInvite.run('访客·临时', mid, at, inv1)
  stmts.revokeInvite.run(at, inv1)
  stmts.deactivateMember.run(at, mid)
  // 待接受邀请：开箱即可演示接受流程
  stmts.insertInvite.run('FAMILY2026', ownerId, 'member', '邀请家人', at)
}
