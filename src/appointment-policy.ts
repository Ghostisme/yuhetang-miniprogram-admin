import type { Appointment } from './types'

/** Use server time plus elapsed time since receipt, so phone clock skew cannot unlock changes. */
export function appointmentActions(item: Appointment, clientNow = Date.now()) {
  const policy = item.customerActions
  const serverTime = Date.parse(policy?.serverTime || ''), deadline = Date.parse(policy?.deadline || '')
  const known = Number.isFinite(serverTime) && Number.isFinite(deadline) && Number.isFinite(item.clientReceivedAt)
  const current = known ? serverTime + Math.max(0, clientNow - item.clientReceivedAt!) : Infinity
  const before = known && current < deadline && ['PENDING', 'CONFIRMED'].includes(item.status)
  const expires = Date.parse(item.rescheduleRequest?.expiresAt || '')
  const pending = item.rescheduleRequest?.status === 'PENDING' && current < expires
  return {
    canCancel: before && !!policy?.canCancel,
    canReschedule: before && !!policy?.canReschedule && !pending,
    canWithdrawReschedule: !!policy?.canWithdrawReschedule && pending,
    pending,
    reason: !known ? '请刷新预约以核对可操作时间，如需协助请联系门店。'
      : !before && ['PENDING', 'CONFIRMED'].includes(item.status) ? '已超过自助处理截止时间，取消或改约请联系门店。'
      : policy?.reason || '',
  }
}

export function stampAppointments(items: Appointment[], receivedAt = Date.now()) {
  return items.map(item => ({ ...item, clientReceivedAt: receivedAt }))
}

export function deadlineLabel(value?: string) {
  const instant = Date.parse(value || '')
  return Number.isFinite(instant) ? new Date(instant + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : ''
}
