import crypto from 'node:crypto';

const normalizeEmail = value => String(value || '').trim().toLowerCase();
const hashCode = code => crypto.createHash('sha256').update(code).digest('hex');

// The caller owns the transaction. Registration and signed-in acceptance must
// validate and consume the invitation together with the member/account writes.
export function acceptInvitationMembership(db, { code = '', workspaceSlug = '', userId = null, email = '', name = '' } = {}) {
  const value = String(code || '').trim();
  const slug = String(workspaceSlug || '').trim();
  const suppliedEmail = normalizeEmail(email);
  let invitation;
  if (value) {
    invitation = db.prepare('SELECT * FROM invitations WHERE code_hash=?').get(hashCode(value));
  } else if (slug && suppliedEmail) {
    invitation = db.prepare("SELECT i.* FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE w.slug=? AND lower(i.email)=? AND i.status='pending' AND i.expires_at>? ORDER BY i.created_at DESC LIMIT 1")
      .get(slug, suppliedEmail, new Date().toISOString());
  }
  if (!invitation) throw new Error(value ? '邀请链接无效' : '加入工作区需要有效邀请');
  const workspace = db.prepare('SELECT * FROM workspaces WHERE id=?').get(invitation.workspace_id);
  if (!workspace) throw new Error('邀请链接无效：工作区不存在');
  if (slug && slug !== workspace.slug) throw new Error('邀请工作区不匹配');
  if (invitation.status === 'revoked') throw new Error('邀请已撤销');
  if (invitation.status !== 'accepted' && (invitation.status === 'expired' || !Number.isFinite(Date.parse(invitation.expires_at)) || Date.parse(invitation.expires_at) <= Date.now())) throw new Error('邀请已过期');
  if (!['pending', 'accepted'].includes(invitation.status)) throw new Error('邀请链接无效');

  const recipientEmail = suppliedEmail || (!userId ? normalizeEmail(invitation.email) : '');
  if (!recipientEmail || !/^\S+@\S+\.\S+$/.test(recipientEmail)) throw new Error('接受邀请需要有效邮箱');
  const invitedRole = invitation.role === 'admin' ? 'admin' : 'member';
  let member = invitation.member_id
    ? db.prepare('SELECT * FROM members WHERE id=? AND workspace_id=?').get(invitation.member_id, workspace.id)
    : null;

  if (invitation.status === 'accepted') {
    // Old accept endpoints created unbound member rows. Only that row's email
    // may claim it; a link-only invitation must never be repurposed afterwards.
    if (!member || (member.user_id ? member.user_id !== userId : normalizeEmail(member.email) !== recipientEmail)) throw new Error('邀请已经被其他账号使用');
    if (member.user_id) return { invitation, workspace, member, duplicate: true };
  }
  if (invitation.email && normalizeEmail(invitation.email) !== recipientEmail) throw new Error('邀请邮箱不匹配');

  if (!member) {
    member = userId ? db.prepare('SELECT * FROM members WHERE workspace_id=? AND user_id=?').get(workspace.id, userId) : null;
    member ||= db.prepare('SELECT * FROM members WHERE workspace_id=? AND lower(email)=?').get(workspace.id, recipientEmail);
  }
  if (member?.user_id && member.user_id !== userId) throw new Error('该邮箱已属于其他账号的工作区成员');
  const duplicate = Boolean(member);
  const timestamp = new Date().toISOString();
  const memberName = String(name || recipientEmail.split('@')[0] || '新成员').trim();
  if (member && !member.user_id && userId) {
    const memberRole = member.role === 'owner' && normalizeEmail(member.email) === recipientEmail ? 'owner' : invitedRole;
    db.prepare('UPDATE members SET user_id=?,name=?,email=?,role=? WHERE id=?').run(userId, memberName, recipientEmail, memberRole, member.id);
  } else if (!member) {
    const memberId = `member_${crypto.randomUUID()}`;
    db.prepare('INSERT INTO members(id,user_id,workspace_id,name,email,role,avatar,joined_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(memberId, userId, workspace.id, memberName, recipientEmail, invitedRole, null, timestamp);
    member = { id: memberId };
  }
  member = db.prepare('SELECT * FROM members WHERE id=?').get(member.id);
  if (invitation.status !== 'accepted') {
    db.prepare("UPDATE invitations SET status='accepted',accepted_at=?,member_id=? WHERE id=?").run(timestamp, member.id, invitation.id);
  }
  return { invitation: db.prepare('SELECT * FROM invitations WHERE id=?').get(invitation.id), workspace, member, ...(duplicate ? { duplicate: true } : {}) };
}
