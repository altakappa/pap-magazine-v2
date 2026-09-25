'use strict';
/**
 * 풀레터 발급 때 팀원 처리 (2026-09-25). 설계 이유는 pullletterTeamCopy.js 머리말.
 *   · 인스타 아이디가 PAP 회원(profiles.instagram, 소문자·@ 없음으로 저장됨)과 같으면 → 회원 알림 대상
 *   · 그 밖의 팀원 → 신청자 발급 메일의 "팀원에게 알려 주세요" 이름 목록
 *   · 신청자 본인(같은 회원, 또는 contact 와 같은 이름)은 둘 다에서 뺀다
 * 조회가 실패하면 알림 없이 이름 목록만 돌려준다(발급 자체는 막지 않는다).
 */
const { teamMembers } = require('./pullletterTeamCopy');

async function planTeam(db, pullLetter) {
  const team = teamMembers(pullLetter && pullLetter.team_info);
  const contact = pullLetter && pullLetter.team_info && pullLetter.team_info.contact;
  const contactName = String((contact && contact.name) || '').trim().toLowerCase();
  const handles = [...new Set(team.map((m) => m.handle).filter(Boolean))];
  const byHandle = new Map();
  if (handles.length) {
    try {
      const { data, error } = await db.from('profiles')
        .select('id, email, name, display_name, instagram, language, email_language, country')
        .in('instagram', handles);
      if (error) throw error;
      (data || []).forEach((p) => { if (p && p.instagram) byHandle.set(String(p.instagram).toLowerCase(), p); });
    } catch (e) {
      console.warn('[pullletterTeam] 회원 찾기 실패 — 알림 없이 이름만 싣는다:', (e && e.message) || e);
    }
  }
  const members = [], inviteNames = [], seenMember = new Set(), seenName = new Set();
  team.forEach((m) => {
    const p = m.handle ? byHandle.get(m.handle) : null;
    if (p) {
      if (p.id === pullLetter.user_id || seenMember.has(p.id) || !p.email) return;
      seenMember.add(p.id);
      members.push({ profile: p, role: m.role });
      return;
    }
    const label = m.name || ('@' + m.handle);
    const key = label.toLowerCase();
    if (!label || key === contactName || seenName.has(key)) return;
    seenName.add(key);
    inviteNames.push(label);
  });
  return { members, inviteNames };
}

module.exports = { planTeam };
