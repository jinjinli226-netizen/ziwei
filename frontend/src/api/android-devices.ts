// Reuse the terminal protocol through the main workspace session.
import { API_BASE, workspaceSlug } from '../api.js'
const terminalBase = () => `${API_BASE}/api/workspaces/${encodeURIComponent(workspaceSlug())}/ziwei-connect/terminal/android-devices`

export type AndroidRole = 'agent' | 'updater'
export type AndroidCommandAction = 'health' | 'screenshot' | 'tap' | 'swipe' | 'text' | 'global' | 'launch'
export type AndroidCommandStatus = 'queued' | 'delivered' | 'executing' | 'succeeded' | 'failed' | 'uncertain' | 'expired' | 'cancelled' | 'acknowledged'
export type AndroidUpdateStatus = 'planned' | 'downloading' | 'verified' | 'installing' | 'awaiting_user_action' | 'installed' | 'awaiting_health' | 'committed' | 'failed' | 'repair_required' | 'cancelled' | 'superseded'

export interface AndroidNode {
  role: AndroidRole
  status: 'online' | 'offline'
  versionCode: number | null
  versionName: string | null
  lastSeen: string | null
  health: {
    accessibility: boolean
    screenOn: boolean
    locked: boolean
    peerBound: boolean
    canInstall: boolean
    installerPackage: string | null
    lastError?: string | null
  }
}

export interface AndroidCommand {
  id: string
  deviceId: string
  role: AndroidRole
  action: AndroidCommandAction
  args: Record<string, unknown>
  epoch: number
  status: AndroidCommandStatus
  createdAt: string
  expiresAt: string
  result?: unknown
  error?: string | null
  resolutionNote?: string
  resolvedAt?: string
}

export interface AndroidUpdate {
  id: string
  deviceId: string
  targetRole: AndroidRole
  installerRole: AndroidRole
  apkUrl: string
  sha256: string
  signerSha256: string
  versionCode: number
  status: AndroidUpdateStatus
  createdAt: string
  error?: string | null
  replacesUpdateId?: string
  replacementId?: string
}

export interface AndroidSnapshot {
  data: string
  mime: string
  width: number
  height: number
  capturedAt: string
}

export interface AndroidDevice {
  id: string
  terminalId: string
  alias: string
  nodes: AndroidNode[]
  control: { role: AndroidRole | null; epoch: number; draining?: boolean; leaseExpiresAt?: string | null }
  commands: AndroidCommand[]
  updates: AndroidUpdate[]
  snapshot: AndroidSnapshot | null
}

export interface AndroidCredentials {
  device: AndroidDevice
  tokens: Record<AndroidRole, string>
}

export interface AndroidUpdateInput {
  targetRole: AndroidRole
  apkUrl: string
  sha256: string
  signerSha256: string
  versionCode: number
  replacesUpdateId?: string
  preflightCommandId?: string
}

export interface AndroidEnrollmentRequest {
  id: string
  alias: string
  role: AndroidRole
  versionCode: number
  versionName: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  createdAt: string
  expiresAt: string
  deviceId?: string
}

export class AndroidApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'AndroidApiError'
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${terminalBase()}${path}`, {
      ...options,
      credentials: 'include',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/json', ...options.headers },
    })
  } catch (cause) {
    if (options.signal?.aborted) throw cause
    throw new AndroidApiError(options.method === 'POST'
      ? '请求未获确认，请刷新设备与回执后核对，避免重复提交。'
      : '无法连接手机接入服务，请稍后重试或检查控制服务状态。')
  }
  if (response.status === 401) window.dispatchEvent(new CustomEvent('ziwei:auth-required'))
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: unknown; error?: unknown } | null
    const message = typeof payload?.message === 'string' ? payload.message : typeof payload?.error === 'string' ? payload.error : `请求失败（${response.status}）`
    if (response.status === 404 && path === '' && options.method !== 'POST') {
      throw new AndroidApiError('当前服务尚未提供手机远控接口，请加载新版后端后重试。', 404)
    }
    throw new AndroidApiError(response.status === 409 ? `操作冲突：${message}` : message, response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const devicePath = (id: string) => `/${encodeURIComponent(id)}`

export const androidDeviceApi = {
  list: (signal?: AbortSignal) => request<{ devices: AndroidDevice[] }>('?summary=1', { signal }),
  enrollmentRequests: (signal?: AbortSignal) => request<{ requests: AndroidEnrollmentRequest[] }>('/enrollment-requests', { signal }),
  approveEnrollment: (id: string) => request<{ request: AndroidEnrollmentRequest; device: AndroidDevice }>(`/enrollment-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: '{}' }),
  rejectEnrollment: (id: string) => request<{ request: AndroidEnrollmentRequest }>(`/enrollment-requests/${encodeURIComponent(id)}/reject`, { method: 'POST', body: '{}' }),
  status: (id: string, signal?: AbortSignal) => request<{ device: AndroidDevice }>(`${devicePath(id)}/status`, { signal }),
  snapshot: (id: string, signal?: AbortSignal) => request<{ deviceId: string; snapshot: AndroidSnapshot | null }>(`${devicePath(id)}/snapshot`, { signal }),
  detail: (id: string, signal?: AbortSignal) => request<{ device: AndroidDevice }>(`${devicePath(id)}`, { signal }),
  register: (alias: string) => request<AndroidCredentials>('', { method: 'POST', body: JSON.stringify({ alias }) }),
  archive: (id: string) => request<{ deviceId: string; terminalId: string; archivedAt: string }>(`${devicePath(id)}/archive`, { method: 'POST', body: JSON.stringify({ confirm: true }) }),
  control: (id: string, role: AndroidRole | null) => request<{ device: AndroidDevice }>(`${devicePath(id)}/control`, { method: 'POST', body: JSON.stringify({ role }) }),
  command: (id: string, action: AndroidCommandAction, args: Record<string, unknown>) => request<{ command: AndroidCommand }>(`${devicePath(id)}/commands`, { method: 'POST', body: JSON.stringify({ action, args }) }),
  resolveCommand: (id: string, commandId: string, note: string) => request<{ command: AndroidCommand }>(`${devicePath(id)}/commands/${encodeURIComponent(commandId)}/resolve`, { method: 'POST', body: JSON.stringify({ resolution: 'acknowledged', note }) }),
  update: (id: string, input: AndroidUpdateInput) => request<{ update: AndroidUpdate }>(`${devicePath(id)}/updates`, { method: 'POST', body: JSON.stringify(input) }),
  resolve: (id: string, updateId: string, resolution: 'cancel' | 'verified') => request<{ update: AndroidUpdate }>(`${devicePath(id)}/updates/${encodeURIComponent(updateId)}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) }),
}
