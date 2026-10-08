<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AppIcon from './TerminalIcon.vue'
import ModalDialog from './TerminalModal.vue'
import { androidDeviceApi } from '../../api/android-devices'
import type { AndroidCommand, AndroidCommandAction, AndroidCredentials, AndroidDevice, AndroidEnrollmentRequest, AndroidNode, AndroidRole, AndroidUpdate, AndroidUpdateStatus } from '../../api/android-devices'
import { formatTerminalTime as formatTime } from './format.js'

const props = defineProps<{ canManage: boolean; selectedDeviceId?: string }>()
const emit = defineEmits<{ 'devices-change': [devices: AndroidDevice[]]; 'select-device': [device: AndroidDevice | null]; 'command-resolved': [receipt: { deviceId: string; commandId: string }] }>()

const roles: AndroidRole[] = ['agent', 'updater']
const publicDeviceApiUrl = import.meta.env.VITE_DEVICE_API_URL || window.location.origin
const roleName = (role: AndroidRole | null) => role === 'agent' ? 'Agent' : role === 'updater' ? 'Updater' : '已暂停'
const devices = ref<AndroidDevice[]>([])
const enrollmentRequests = ref<AndroidEnrollmentRequest[]>([])
const enrollmentLoading = ref(false)
const enrollmentLoaded = ref(false)
const enrollmentError = ref('')
const enrollmentAction = ref<{ id: string; action: 'approve' | 'reject' } | null>(null)
const enrollmentOutcomes = ref<AndroidEnrollmentRequest[]>([])
const now = ref(Date.now())
const enrollmentState = (request: AndroidEnrollmentRequest) => request.status === 'pending' && Date.parse(request.expiresAt) <= now.value ? 'expired' : request.status
const pendingEnrollmentCount = computed(() => enrollmentRequests.value.filter(request => enrollmentState(request) === 'pending').length)
const enrollmentStatusLabels = { pending: '待审核', approved: '已批准', rejected: '已拒绝', expired: '已过期' }
const selectedId = ref('')
const loaded = ref(false)
const loading = ref(false)
const busy = ref(false)
const syncError = ref('')
const actionError = ref('')
const notice = ref('')
const syncedAt = ref<string | null>(null)
const showRegister = ref(false)
const alias = ref('')
const credentials = ref<AndroidCredentials | null>(null)
const credentialApiUrl = ref(publicDeviceApiUrl)
const formError = ref('')
const copiedRole = ref<AndroidRole | null>(null)
const manipulationEnabled = ref(false)
const gestureMode = ref<'tap' | 'swipe'>('tap')
const swipeDuration = ref(500)
const inputText = ref('')
const globalKey = ref<'back' | 'home' | 'recents'>('back')
const packageName = ref('')
const targetRole = ref<AndroidRole>('agent')
const apkUrl = ref('')
const apkHash = ref('')
const signerHash = ref('')
const versionCode = ref<number | ''>('')
const updateError = ref('')
const replacesUpdateId = ref('')
type PublishedPackage = { packageName: string; file: string; path: string; sha256: string; signerSha256: string }
type PublishedRelease = { versionName: string; versionCode: number; buildType: string; packages: Record<AndroidRole, PublishedPackage> }
const publishedReleases = ref<PublishedRelease[]>([])
const selectedReleaseKey = ref('')
const resolveTarget = ref<AndroidUpdate | null>(null)
const resolution = ref<'cancel' | 'verified'>('verified')
const resolutionChecked = ref(false)
const resolveError = ref('')
const commandResolveTarget = ref<AndroidCommand | null>(null)
const commandResolutionNote = ref('')
const commandResolveError = ref('')
const lifecycle = new AbortController()
let refreshPromise: Promise<void> | null = null
const detailRequests = new Map<string, Promise<AndroidDevice | null>>()
let timer: ReturnType<typeof setInterval> | undefined
let gesture: { pointerId: number; x: number; y: number; deviceId: string; capturedAt: string; epoch: number; width: number; height: number; mode: 'tap' | 'swipe' } | null = null

const selected = computed(() => devices.value.find(device => device.id === selectedId.value) ?? null)
const currentNode = computed(() => selected.value?.nodes.find(node => node.role === selected.value?.control.role))
const currentSnapshot = computed(() => selected.value?.snapshot ?? null)
const snapshotSrc = computed(() => {
  const snapshot = currentSnapshot.value
  if (!snapshot || !['image/jpeg', 'image/png'].includes(snapshot.mime) || !snapshot.data || snapshot.data.length > 2 * 1024 * 1024) return ''
  if (!Number.isInteger(snapshot.width) || !Number.isInteger(snapshot.height) || snapshot.width <= 0 || snapshot.height <= 0) return ''
  return `data:${snapshot.mime};base64,${snapshot.data}`
})
const terminalUpdates = new Set<AndroidUpdateStatus>(['committed', 'cancelled', 'superseded'])
const activeUpdates = computed(() => (selected.value?.updates ?? []).filter(update => !terminalUpdates.has(update.status)))
const repairUpdate = computed(() => activeUpdates.value.find(update => update.id === replacesUpdateId.value && ['awaiting_health', 'repair_required'].includes(update.status)) ?? null)
const recentCommands = computed(() => {
  const commands = [...(selected.value?.commands ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const unresolved = (command: AndroidCommand) => ['queued', 'delivered', 'executing', 'uncertain'].includes(command.status)
  return [...commands.filter(unresolved), ...commands.filter(command => !unresolved(command)).slice(0, 20)]
})
const recentUpdates = computed(() => [...(selected.value?.updates ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const controlUnavailable = computed(() => !props.canManage || busy.value || !loaded.value || !!syncError.value)
const updateFormUnavailable = computed(() => controlUnavailable.value || (!!activeUpdates.value.length && !repairUpdate.value))
const diagnosticBlockReason = computed(() => {
  const device = selected.value
  if (!device) return '请先选择手机。'
  if (syncError.value) return '数据同步中断，恢复同步后才能发出指令。'
  if (device.control.draining) return '正在等待原控制端授权结束，结束后请再次提交切换或升级。'
  if (!device.control.role) return '当前已暂停，请先选择控制端。'
  if (currentNode.value?.status !== 'online') return '当前控制端离线或尚未接入。'
  return ''
})
const commandBlockReason = computed(() => diagnosticBlockReason.value)
const diagnosticUnavailable = computed(() => controlUnavailable.value || !!diagnosticBlockReason.value)
const commandUnavailable = computed(() => controlUnavailable.value || !!commandBlockReason.value)
const manipulationUnavailable = computed(() => commandUnavailable.value || !manipulationEnabled.value)
const upgradeInstaller = computed(() => selected.value?.nodes.find(node => node.role === (targetRole.value === 'agent' ? 'updater' : 'agent')))
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : '操作失败，请重试。'
const commandLabels: Record<AndroidCommandAction, string> = { health: '检查健康', screenshot: '请求截图', tap: '点击', swipe: '滑动', text: '输入文字', global: '系统按键', launch: '打开应用' }
const commandStatusLabels: Record<string, string> = { queued: '等待投递', delivered: '已投递', executing: '执行中', succeeded: '执行成功', failed: '执行失败', uncertain: '结果未知 · 需核实', expired: '已过期', cancelled: '已取消', acknowledged: '已人工核实 · 未重放' }
const updateStatusLabels: Record<AndroidUpdateStatus, string> = { planned: '等待对端处理', downloading: '正在下载', verified: '安装包已校验', installing: '正在安装', awaiting_user_action: '等待手机上授权安装', installed: '安装已回报 · 待验收', awaiting_health: '等待新版本健康心跳', committed: '升级已验收', failed: '升级失败', repair_required: '等待人工核实', cancelled: '事务已取消', superseded: '已转入修复事务' }

function stateClass(status: string) {
  if (['online', 'succeeded', 'committed'].includes(status)) return 'succeeded'
  if (['failed', 'repair_required'].includes(status)) return 'failed'
  if (['uncertain', 'awaiting_user_action', 'awaiting_health', 'installed'].includes(status)) return 'uncertain'
  if (['executing', 'downloading', 'installing', 'delivered'].includes(status)) return 'running'
  if (['planned', 'verified', 'queued'].includes(status)) return 'queued'
  return 'neutral'
}

function nodeFor(role: AndroidRole) { return selected.value?.nodes.find(node => node.role === role) }
function healthValue(node: AndroidNode | undefined, key: keyof AndroidNode['health'], yes: string, no: string) {
  return !node || typeof node.health?.[key] !== 'boolean' ? '尚未上报' : node.health[key] ? yes : no
}

function refresh(): Promise<void> {
  if (refreshPromise) return refreshPromise
  loading.value = true
  refreshPromise = (async () => {
    try {
      const result = await androidDeviceApi.list(lifecycle.signal)
      if (lifecycle.signal.aborted) return
      const previous = new Map(devices.value.map(device => [device.id, device]))
      devices.value = result.devices.map(device => {
        const cached = previous.get(device.id)
        const mergeHistory = <T extends { id: string }>(history: T[] = [], active: T[] = []) => [...new Map([...history, ...active].map(item => [item.id, item])).values()]
        return { ...device, snapshot: cached?.snapshot ?? device.snapshot, commands: mergeHistory(cached?.commands, device.commands), updates: mergeHistory(cached?.updates, device.updates) }
      })
      emit('devices-change', devices.value)
      loaded.value = true
      syncedAt.value = new Date().toISOString()
      syncError.value = ''
      if (!selectedId.value && result.devices.some(device => device.id === props.selectedDeviceId)) selectedId.value = props.selectedDeviceId || ''
      if (!result.devices.some(device => device.id === selectedId.value)) selectedId.value = result.devices[0]?.id ?? ''
      // Summary omits terminal receipts and results; always read detail after it.
      await loadSelectedDetail()
    } catch (cause) {
      if (!lifecycle.signal.aborted) syncError.value = errorText(cause)
    } finally {
      loading.value = false
      refreshPromise = null
    }
  })()
  return refreshPromise
}

async function loadEnrollmentRequests() {
  if (enrollmentLoading.value || lifecycle.signal.aborted) return
  enrollmentLoading.value = true
  try {
    const result = await androidDeviceApi.enrollmentRequests(lifecycle.signal)
    if (!lifecycle.signal.aborted) {
      enrollmentRequests.value = result.requests
      enrollmentLoaded.value = true
      enrollmentError.value = ''
      now.value = Date.now()
    }
  } catch (cause) {
    if (!lifecycle.signal.aborted) enrollmentError.value = errorText(cause)
  } finally { enrollmentLoading.value = false }
}

async function resolveEnrollment(request: AndroidEnrollmentRequest, action: 'approve' | 'reject') {
  if (!props.canManage || busy.value || enrollmentState(request) !== 'pending') return
  busy.value = true
  enrollmentAction.value = { id: request.id, action }
  actionError.value = ''
  notice.value = ''
  try {
    const result = action === 'approve'
      ? await androidDeviceApi.approveEnrollment(request.id)
      : await androidDeviceApi.rejectEnrollment(request.id)
    const expectedStatus = action === 'approve' ? 'approved' : 'rejected'
    if (result.request.status !== expectedStatus) {
      Object.assign(request, result.request)
      enrollmentOutcomes.value = [result.request, ...enrollmentOutcomes.value.filter(item => item.id !== request.id)].slice(0, 6)
      throw new Error(`这条申请${enrollmentStatusLabels[result.request.status] || '状态已变化'}，请刷新后核对。`)
    }
    enrollmentOutcomes.value = [result.request, ...enrollmentOutcomes.value.filter(item => item.id !== request.id)].slice(0, 6)
    enrollmentRequests.value = enrollmentRequests.value.filter(item => item.id !== request.id)
    if (action === 'approve') {
      const approved = result as Awaited<ReturnType<typeof androidDeviceApi.approveEnrollment>>
      if (!approved.device?.id) throw new Error('批准请求已返回，但设备信息暂未同步，请刷新手机列表核对。')
      devices.value = [...devices.value.filter(device => device.id !== approved.device.id), approved.device]
      selectedId.value = approved.device.id
      await refreshAfterMutation()
    }
    await loadEnrollmentRequests()
    notice.value = action === 'approve' ? `${request.alias} 已批准入网，手机会自动收到 Agent / Updater 配置。` : `${request.alias} 的入网申请已拒绝。`
  } catch (cause) {
    if (!lifecycle.signal.aborted) {
      actionError.value = errorText(cause)
      if (/过期/.test(actionError.value)) {
        request.status = 'expired'
        enrollmentOutcomes.value = [request, ...enrollmentOutcomes.value.filter(item => item.id !== request.id)].slice(0, 6)
      }
    }
  } finally { busy.value = false; enrollmentAction.value = null }
}

function loadDeviceDetail(id: string): Promise<AndroidDevice | null> {
  if (!id || lifecycle.signal.aborted) return Promise.resolve(null)
  const pending = detailRequests.get(id)
  if (pending) return pending
  const promise = (async () => {
    try {
      const result = await androidDeviceApi.detail(id, lifecycle.signal)
      if (lifecycle.signal.aborted) return null
      if (selectedId.value === id) devices.value = devices.value.map(device => device.id === id ? result.device : device)
      return result.device
    } catch (cause) {
      if (!lifecycle.signal.aborted) actionError.value = errorText(cause)
      return null
    } finally { detailRequests.delete(id) }
  })()
  detailRequests.set(id, promise)
  return promise
}

function loadSelectedDetail() { return loadDeviceDetail(selectedId.value) }

async function loadPublishedPackages() {
  try {
    const response = await fetch('/downloads/android/index.json', { cache: 'no-store', signal: lifecycle.signal })
    if (!response.ok) return
    const payload = await response.json() as { releases?: PublishedRelease[] }
    if (Array.isArray(payload.releases)) publishedReleases.value = payload.releases.filter(release => release?.packages?.agent && release?.packages?.updater)
  } catch { /* The update form remains available for a manually supplied HTTPS path. */ }
}

function applyPublishedPackage() {
  const release = publishedReleases.value.find(item => `${item.versionName}-${item.versionCode}` === selectedReleaseKey.value)
  const pkg = release?.packages?.[targetRole.value]
  if (!release || !pkg) return
  const base = publicDeviceApiUrl || window.location.origin
  apkUrl.value = new URL(pkg.path, base).href
  apkHash.value = pkg.sha256
  signerHash.value = pkg.signerSha256
  versionCode.value = release.versionCode
  updateError.value = ''
}

async function refreshAfterMutation() {
  if (refreshPromise) await refreshPromise
  if (!lifecycle.signal.aborted) await refresh()
}

function openRegister() {
  if (!props.canManage || busy.value) return
  alias.value = ''
  formError.value = ''
  credentials.value = null
  credentialApiUrl.value = publicDeviceApiUrl
  copiedRole.value = null
  showRegister.value = true
}

function closeRegister() {
  if (busy.value) return
  showRegister.value = false
  credentials.value = null
  credentialApiUrl.value = publicDeviceApiUrl
  copiedRole.value = null
  formError.value = ''
}

async function registerDevice() {
  if (!props.canManage || busy.value) return
  formError.value = ''
  if (!alias.value.trim()) { formError.value = '请填写手机名称。'; return }
  busy.value = true
  try {
    const result = await androidDeviceApi.register(alias.value.trim())
    if (lifecycle.signal.aborted) return
    credentials.value = result
    devices.value = [...devices.value.filter(device => device.id !== result.device.id), result.device]
    selectedId.value = result.device.id
    await refreshAfterMutation()
    if (!lifecycle.signal.aborted && devices.value.some(device => device.id === result.device.id)) selectedId.value = result.device.id
  } catch (cause) { if (!lifecycle.signal.aborted) formError.value = errorText(cause) }
  finally { busy.value = false }
}

async function copyCredential(role: AndroidRole) {
  formError.value = ''
  if (!credentials.value) return
  try { await navigator.clipboard.writeText(credentials.value.tokens[role]); copiedRole.value = role }
  catch { formError.value = '复制失败，请手动复制凭证或下载配置。' }
}

function downloadConfig(role: AndroidRole) {
  formError.value = ''
  if (!credentials.value) return
  try {
    let apiUrl = ''
    if (credentialApiUrl.value.trim()) {
      const url = new URL(credentialApiUrl.value.trim())
      if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('请填写手机实际可达的 HTTPS 根地址；本机 localhost / 127.0.0.1 不能作为手机流量入口。')
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('请填写不含路径、账号、查询参数或片段的 HTTPS 根地址。')
      apiUrl = url.origin
    }
    const config = { schemaVersion: 1, apiUrl, deviceId: credentials.value.device.id, role, token: credentials.value.tokens[role] }
    const href = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `android-${role}-access.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  } catch (cause) { formError.value = errorText(cause) }
}

async function changeControl(role: AndroidRole | null) {
  const device = selected.value
  if (!device || controlUnavailable.value) return
  busy.value = true
  manipulationEnabled.value = false
  actionError.value = ''
  notice.value = ''
  try {
    await androidDeviceApi.control(device.id, role)
    if (!lifecycle.signal.aborted) notice.value = role === null
      ? `${device.alias} 已暂停新指令；已发出的动作仍需等候回执。`
      : `${device.alias} 的控制端已设为 ${roleName(role)}，是否可执行以该端健康状态为准。`
  } catch (cause) { if (!lifecycle.signal.aborted) actionError.value = errorText(cause) }
  finally { await refreshAfterMutation(); busy.value = false }
}

async function archiveSelected() {
  const device = selected.value
  if (!props.canManage || !device || busy.value) return
  if (!window.confirm(`确认移除“${device.alias}”？移除后它会从设备列表隐藏，历史指令和审计记录仍会保留。`)) return
  busy.value = true
  actionError.value = ''
  notice.value = ''
  try {
    await androidDeviceApi.archive(device.id)
    selectedId.value = ''
    await refreshAfterMutation()
    notice.value = `已移除手机“${device.alias}”`
  } catch (cause) {
    if (!lifecycle.signal.aborted) actionError.value = errorText(cause)
  } finally { busy.value = false }
}

async function sendCommand(action: AndroidCommandAction, args: Record<string, unknown> = {}) {
  const device = selected.value
  if (!device || (['health', 'screenshot'].includes(action) ? diagnosticUnavailable.value : commandUnavailable.value)) return
  if (!['health', 'screenshot'].includes(action) && !manipulationEnabled.value) return
  busy.value = true
  actionError.value = ''
  notice.value = ''
  try {
    const { command } = await androidDeviceApi.command(device.id, action, args)
    if (!lifecycle.signal.aborted) {
      notice.value = `${device.alias} · ${commandLabels[action]}已提交，等待手机回执。`
      device.commands = [command, ...device.commands.filter(item => item.id !== command.id)]
    }
  } catch (cause) { if (!lifecycle.signal.aborted) actionError.value = errorText(cause) }
  finally {
    await refreshAfterMutation()
    busy.value = false
  }
}

function snapshotPoint(event: PointerEvent) {
  const image = event.currentTarget as HTMLImageElement
  const snapshot = currentSnapshot.value
  if (!snapshot || !image.complete || !image.naturalWidth) return null
  const rect = image.getBoundingClientRect()
  if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null
  return {
    x: Math.min(snapshot.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * snapshot.width))),
    y: Math.min(snapshot.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * snapshot.height))),
  }
}

function startGesture(event: PointerEvent) {
  if (manipulationUnavailable.value || !event.isPrimary || event.button !== 0 || !selected.value || !currentSnapshot.value) return
  const point = snapshotPoint(event)
  if (!point) return
  event.preventDefault()
  const snapshot = currentSnapshot.value
  gesture = { pointerId: event.pointerId, ...point, deviceId: selected.value.id, capturedAt: snapshot.capturedAt, epoch: selected.value.control.epoch, width: snapshot.width, height: snapshot.height, mode: gestureMode.value }
  ;(event.currentTarget as HTMLImageElement).setPointerCapture(event.pointerId)
}

function cancelGesture() { gesture = null }

async function finishGesture(event: PointerEvent) {
  const start = gesture
  gesture = null
  if (!start || start.pointerId !== event.pointerId || manipulationUnavailable.value) return
  const point = snapshotPoint(event)
  if (!point || selected.value?.id !== start.deviceId || selected.value.control.epoch !== start.epoch || currentSnapshot.value?.capturedAt !== start.capturedAt) return
  if (start.mode === 'tap') {
    if (Math.hypot(point.x - start.x, point.y - start.y) > 12) { actionError.value = '点击模式中检测到拖动，未发送指令。请切换到滑动模式。'; return }
    await sendCommand('tap', { x: point.x, y: point.y, width: start.width, height: start.height })
  } else {
    if (!Number.isInteger(swipeDuration.value) || swipeDuration.value < 1 || swipeDuration.value > 2000) { actionError.value = '滑动时长需为 1–2000 毫秒。'; return }
    if (Math.hypot(point.x - start.x, point.y - start.y) < 5) { actionError.value = '滑动距离过短，未发送指令。请在画面内拖动。'; return }
    await sendCommand('swipe', { x1: start.x, y1: start.y, x2: point.x, y2: point.y, width: start.width, height: start.height, durationMs: swipeDuration.value })
  }
}

async function sendText() {
  if (!inputText.value.length || inputText.value.length > 2000) { actionError.value = '请输入 1–2000 个字符。'; return }
  await sendCommand('text', { text: inputText.value })
}

async function launchApp() {
  const name = packageName.value.trim()
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(name)) { actionError.value = '请输入有效的 Android 应用包名，例如 com.example.app。'; return }
  await sendCommand('launch', { packageName: name })
}

const waitFor = (ms: number) => new Promise<void>(resolve => {
  const stop = () => { clearTimeout(timeout); lifecycle.signal.removeEventListener('abort', stop); resolve() }
  const timeout = setTimeout(stop, ms)
  lifecycle.signal.addEventListener('abort', stop, { once: true })
  if (lifecycle.signal.aborted) stop()
})

function assertUpdatePage(deviceId: string) {
  if (lifecycle.signal.aborted || selectedId.value !== deviceId) throw new Error('已离开当前手机页面，升级未继续下发。')
}

async function observeBeforeUpdate(device: AndroidDevice) {
  assertUpdatePage(device.id)
  const { command } = await androidDeviceApi.command(device.id, 'screenshot', {})
  assertUpdatePage(device.id)
  notice.value = `${device.alias} · 正在读取手机画面，确认当前状态后再下发升级。`
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    assertUpdatePage(device.id)
    // Read the captured phone directly: summary drops a command once it succeeds.
    const { device: current } = await androidDeviceApi.detail(device.id, lifecycle.signal)
    assertUpdatePage(device.id)
    devices.value = devices.value.map(item => item.id === device.id ? current : item)
    const observed = current.commands.find(item => item.id === command.id)
    if (observed?.status === 'succeeded') {
      if (!current.snapshot || Date.parse(current.snapshot.capturedAt) < Date.parse(command.createdAt)) throw new Error('手机已回执，但最新截图尚未同步，请刷新后再试。')
      return command.id
    }
    if (observed && ['failed', 'uncertain', 'expired', 'acknowledged', 'cancelled'].includes(observed.status)) throw new Error(observed.error ?? '升级前读取手机状态失败，未下发升级。')
    await waitFor(500)
  }
  throw new Error('升级前读取手机状态超时，未下发升级。')
}

async function submitUpdate() {
  const device = selected.value
  const repair = repairUpdate.value
  if (!device || updateFormUnavailable.value) return
  updateError.value = ''
  let downloadUrl: URL
  try {
    downloadUrl = new URL(apkUrl.value.trim())
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(downloadUrl.hostname)
    if (downloadUrl.protocol !== 'https:' && !(loopback && downloadUrl.protocol === 'http:')) throw new Error('安装包需使用 HTTPS 地址；HTTP 只允许明确的 loopback 本机开发地址。')
    if (downloadUrl.username || downloadUrl.password || downloadUrl.hash) throw new Error('安装包地址不能含账号、密码或片段。')
    if (!/^[a-fA-F0-9]{64}$/.test(apkHash.value.trim()) || !/^[a-fA-F0-9]{64}$/.test(signerHash.value.trim())) throw new Error('APK SHA-256 和签名证书 SHA-256 均需填写 64 位十六进制摘要。')
    if (!Number.isSafeInteger(versionCode.value) || Number(versionCode.value) <= 0) throw new Error('目标 versionCode 必须为正整数。')
    const currentVersion = device.nodes.find(node => node.role === targetRole.value)?.versionCode
    if (currentVersion != null && Number(versionCode.value) <= currentVersion) throw new Error(`目标 versionCode 必须高于当前版本 ${currentVersion}。`)
    if (repair && Number(versionCode.value) <= repair.versionCode) throw new Error(`修复包 versionCode 必须高于原升级版本 ${repair.versionCode}。`)
  } catch (cause) { updateError.value = errorText(cause); return }
  busy.value = true
  manipulationEnabled.value = false
  notice.value = ''
  actionError.value = ''
  try {
    const preflightCommandId = await observeBeforeUpdate(device)
    assertUpdatePage(device.id)
    const { update } = await androidDeviceApi.update(device.id, { targetRole: targetRole.value, apkUrl: downloadUrl.href, sha256: apkHash.value.trim().toLowerCase(), signerSha256: signerHash.value.trim().toLowerCase(), versionCode: Number(versionCode.value), preflightCommandId, ...(repair ? { replacesUpdateId: repair.id } : {}) })
    if (!lifecycle.signal.aborted) {
      notice.value = `${device.alias} 的${repair ? '修复' : '升级'}事务已创建，由 ${roleName(update.installerRole)} 安装 ${roleName(update.targetRole)}。安装授权需在手机上确认。`
      replacesUpdateId.value = ''
    }
  } catch (cause) { if (!lifecycle.signal.aborted) updateError.value = errorText(cause) }
  finally { await refreshAfterMutation(); busy.value = false }
}

function prepareRepair(update: AndroidUpdate) {
  if (controlUnavailable.value || !['awaiting_health', 'repair_required'].includes(update.status)) return
  replacesUpdateId.value = update.id
  targetRole.value = update.targetRole
  apkUrl.value = ''
  apkHash.value = ''
  signerHash.value = ''
  versionCode.value = ''
  updateError.value = ''
}

function openResolve(update: AndroidUpdate) {
  resolveTarget.value = update
  resolution.value = 'verified'
  resolutionChecked.value = false
  resolveError.value = ''
}

function openCommandResolve(command: AndroidCommand) {
  commandResolveTarget.value = command
  commandResolutionNote.value = ''
  commandResolveError.value = ''
}

async function resolveCommand() {
  const device = selected.value
  const command = commandResolveTarget.value
  if (!device || !command || controlUnavailable.value) return
  commandResolveError.value = ''
  if (!commandResolutionNote.value.trim() || commandResolutionNote.value.trim().length > 1000) { commandResolveError.value = '请填写 1–1000 字的手机状态和执行结果核实说明。'; return }
  busy.value = true
  manipulationEnabled.value = false
  try {
    await androidDeviceApi.resolveCommand(device.id, command.id, commandResolutionNote.value.trim())
    if (!lifecycle.signal.aborted) {
      notice.value = `${device.alias} 的这条命令已记录人工核实并解除阻塞；未重放命令，也未改写为执行成功。`
      commandResolveTarget.value = null
      commandResolutionNote.value = ''
      emit('command-resolved', { deviceId: device.id, commandId: command.id })
    }
  } catch (cause) { if (!lifecycle.signal.aborted) commandResolveError.value = errorText(cause) }
  finally { await refreshAfterMutation(); busy.value = false }
}

async function resolveUpdate() {
  const device = selected.value
  const update = resolveTarget.value
  if (!device || !update || controlUnavailable.value || !resolutionChecked.value) return
  busy.value = true
  resolveError.value = ''
  try {
    const result = await androidDeviceApi.resolve(device.id, update.id, resolution.value)
    if (!lifecycle.signal.aborted) {
      notice.value = `升级事务处理结果：${updateStatusLabels[result.update.status] ?? result.update.status}。`
      resolveTarget.value = null
    }
  } catch (cause) { if (!lifecycle.signal.aborted) resolveError.value = errorText(cause) }
  finally { await refreshAfterMutation(); busy.value = false }
}

function commandReceipt(command: AndroidCommand) {
  // Keep all receipt metadata while avoiding a second copy of screenshot pixels in text.
  return JSON.stringify(command, (key, value) => command.action === 'screenshot' && ['data', 'base64'].includes(key) && typeof value === 'string' && value.length > 2000 ? `[图像数据 ${value.length} 字符；画面见上方]` : value, 2)
}

function commandSummary(command: AndroidCommand) {
  if (command.status === 'acknowledged') return `已人工核实并解除阻塞，未重放，不代表成功。${command.resolutionNote ? ` 核实说明：${command.resolutionNote}` : ''}`
  if (command.error) return command.error
  if (command.action === 'screenshot' && command.status === 'succeeded') return '手机已回传截图，画面见上方。'
  if (command.status === 'uncertain') return '动作可能已经发生，核实手机实际结果；不要直接重发。'
  if (command.status === 'expired') return '指令已过有效期，不会自动重发。'
  if (command.result === undefined || command.result === null) return '尚无结果内容'
  return JSON.stringify(command.result).slice(0, 300)
}

watch(() => props.selectedDeviceId, id => {
  if (id && devices.value.some(device => device.id === id)) selectedId.value = id
})
watch(selectedId, () => {
  emit('select-device', selected.value)
  manipulationEnabled.value = false
  gesture = null
  actionError.value = ''
  notice.value = ''
  inputText.value = ''
  packageName.value = ''
  updateError.value = ''
  targetRole.value = 'agent'
  apkUrl.value = ''
  apkHash.value = ''
  signerHash.value = ''
  versionCode.value = ''
  replacesUpdateId.value = ''
  resolveTarget.value = null
  commandResolveTarget.value = null
  commandResolutionNote.value = ''
  void loadSelectedDetail()
})
watch([() => selected.value?.control.role, () => selected.value?.control.epoch, () => selected.value?.control.draining, () => currentNode.value?.status, syncError], () => {
  manipulationEnabled.value = false
  gesture = null
})
watch(manipulationEnabled, enabled => { if (!enabled) gesture = null })
watch(resolution, () => { resolutionChecked.value = false; resolveError.value = '' })

onMounted(() => {
  void refresh()
  void loadEnrollmentRequests()
  void loadPublishedPackages()
  timer = setInterval(() => { now.value = Date.now(); if (!document.hidden) { void refresh(); void loadEnrollmentRequests() } }, 5000)
})
onUnmounted(() => {
  clearInterval(timer)
  lifecycle.abort()
  credentials.value = null
  gesture = null
})
</script>

<template>
  <div class="view-stack android-devices-view" data-testid="android-devices">
    <section class="page-intro">
      <div><h2>终端控制台</h2><p>设备状态、手机画面、控制指令与双端更新统一在这里管理。</p></div>
      <div class="button-row"><button class="secondary-button" :disabled="loading || busy" @click="refresh(); loadEnrollmentRequests()"><AppIcon name="refresh" :size="15" />刷新</button><button v-if="canManage" class="primary-button" data-testid="register-phone" :disabled="busy" @click="openRegister"><AppIcon name="plus" :size="16" />登记手机</button></div>
    </section>

    <div v-if="syncError" class="connection-alert" role="alert"><span>手机数据无法同步：{{ syncError }}{{ loaded ? ' 当前保留上次数据，在线状态待重新确认。' : '' }}</span><button class="text-link" :disabled="loading" @click="refresh">重试</button></div>
    <div v-if="actionError" class="connection-alert" role="alert">{{ actionError }}</div>
    <div v-if="notice" class="notice-strip" role="status">{{ notice }}</div>

    <section class="panel enrollment-panel" data-testid="enrollment-requests" :aria-busy="enrollmentLoading">
      <div class="panel-header"><div><h2>待审核入网 <span class="list-count">{{ pendingEnrollmentCount }}</span></h2><p>手机端提交申请；批准后自动下发 Agent 与 Updater 配置，无需导入 JSON。</p></div><button class="secondary-button" data-testid="refresh-enrollments" :disabled="enrollmentLoading || busy" @click="loadEnrollmentRequests">{{ enrollmentLoading ? '读取中…' : '刷新申请' }}</button></div>
      <p v-if="!canManage" class="control-hint">当前为只读访问；工作区所有者或管理员可以审批和管理手机。</p>
      <p v-if="enrollmentError" class="form-error" role="alert" data-testid="enrollment-error">申请读取失败：{{ enrollmentError }}</p>
      <p v-else-if="enrollmentLoading && !enrollmentLoaded" class="compact-message" role="status">正在读取入网申请…</p>
      <p v-else-if="enrollmentLoaded && !enrollmentRequests.length" class="compact-message" data-testid="enrollment-empty">暂无待审核申请。在手机的“连接”页填写本站 HTTPS 地址并点击“申请入网”，申请将自动出现在这里。</p>
      <div class="enrollment-list"><article v-for="request in enrollmentRequests" :key="request.id" class="enrollment-item" :data-testid="`enrollment-${request.id}`" :data-status="enrollmentState(request)"><div><b>{{ request.alias }}</b><small>{{ roleName(request.role) }} · v{{ request.versionName }} · code {{ request.versionCode }} · {{ formatTime(request.createdAt) }}</small><small class="mono">{{ request.id }}</small><small>有效期至 {{ formatTime(request.expiresAt) }}</small></div><div class="enrollment-actions"><span class="state-tag" :class="enrollmentState(request) === 'pending' ? 'queued' : 'neutral'">{{ enrollmentStatusLabels[enrollmentState(request)] }}</span><div v-if="canManage && enrollmentState(request) === 'pending'" class="button-row"><button class="secondary-button" :data-testid="`reject-${request.id}`" :disabled="busy" @click="resolveEnrollment(request, 'reject')">{{ enrollmentAction?.id === request.id && enrollmentAction.action === 'reject' ? '拒绝中…' : '拒绝' }}</button><button class="primary-button" :data-testid="`approve-${request.id}`" :disabled="busy" @click="resolveEnrollment(request, 'approve')">{{ enrollmentAction?.id === request.id && enrollmentAction.action === 'approve' ? '批准中…' : '批准入网' }}</button></div><small v-else-if="enrollmentState(request) === 'expired'">请在手机端重新申请。</small></div></article></div>
      <div v-if="enrollmentOutcomes.length" class="enrollment-outcomes" aria-live="polite"><p v-for="request in enrollmentOutcomes" :key="request.id" :data-status="request.status"><b>{{ request.alias }}</b> · {{ roleName(request.role) }} · {{ enrollmentStatusLabels[request.status] }}<span v-if="request.status === 'approved'">，等待手机自动领取配置并上报心跳。</span></p></div>
    </section>

    <section v-if="!loaded" class="panel loading-state">{{ loading ? '正在读取手机接入数据…' : '手机接入数据尚不可用。请重试连接。' }}</section>
    <section v-else-if="!devices.length" class="panel work-empty"><AppIcon name="device" :size="32" /><h3>还没有接入手机</h3><p>在手机端点击“申请入网”，这里批准后会自动完成配置。</p><button v-if="canManage" class="secondary-button" :disabled="busy" @click="openRegister">手动登记（备用）</button></section>

    <div v-else class="device-workspace">
      <section class="panel phone-list" aria-label="已登记手机">
        <div class="panel-header"><div><h2>手机 <span class="list-count">{{ devices.length }}</span></h2><p>只操作当前选中的设备</p></div></div>
        <div class="phone-options"><button v-for="device in devices" :key="device.id" class="phone-option" :data-testid="`phone-${device.id}`" :class="{ selected: selectedId === device.id }" :aria-pressed="selectedId === device.id" :disabled="busy" @click="selectedId = device.id"><span class="phone-option-title"><AppIcon name="device" :size="16" /><b>{{ device.alias }}</b></span><small class="mono">{{ device.id }}</small><span class="phone-node-status"><span v-for="role in roles" :key="role"><i :class="{ online: !syncError && device.nodes.find(node => node.role === role)?.status === 'online' }" />{{ roleName(role) }} {{ syncError ? '待确认' : device.nodes.find(node => node.role === role)?.status === 'online' ? '在线' : '离线' }}</span></span></button></div>
        <p class="sync-note">每 5 秒同步<br />{{ formatTime(syncedAt) }}</p>
      </section>

      <div v-if="selected" class="device-detail">
        <section class="panel">
          <div class="panel-header device-heading"><div><h2>{{ selected.alias }}</h2><p class="mono">{{ selected.id }}</p></div><div class="device-heading-actions"><span class="state-tag" :class="syncError ? 'neutral' : selected.control.draining ? 'queued' : selected.control.role ? 'running' : 'neutral'">{{ syncError ? '控制状态待确认' : selected.control.draining ? '等待授权结束' : `当前控制端：${roleName(selected.control.role)}` }}</span><button v-if="canManage" class="danger-button" data-testid="archive-phone" :disabled="busy" @click="archiveSelected">移除手机</button></div></div>
          <slot name="device-binding" :device="selected" />
          <div class="node-grid"><article v-for="role in roles" :key="role" class="node-card"><header><b>{{ roleName(role) }}</b><span class="state-tag" :class="syncError ? 'neutral' : nodeFor(role)?.status === 'online' ? 'online' : 'offline'">{{ syncError ? '状态待确认' : nodeFor(role)?.status === 'online' ? '在线' : '离线' }}</span></header><p class="version-line">{{ nodeFor(role)?.versionName ? `v${nodeFor(role)?.versionName}` : '版本未上报' }} <span v-if="nodeFor(role)?.versionCode != null"> · code {{ nodeFor(role)?.versionCode }}</span></p><dl><div><dt>无障碍</dt><dd>{{ healthValue(nodeFor(role), 'accessibility', '已开启', '未开启') }}</dd></div><div><dt>安装能力</dt><dd>{{ healthValue(nodeFor(role), 'canInstall', '可请求安装', '未授权') }}</dd></div><div><dt>屏幕 / 锁屏</dt><dd>{{ healthValue(nodeFor(role), 'screenOn', '亮屏', '息屏') }} / {{ healthValue(nodeFor(role), 'locked', '已锁定', '未锁定') }}</dd></div><div><dt>对端连接</dt><dd>{{ healthValue(nodeFor(role), 'peerBound', '已绑定', '未绑定') }}</dd></div><div><dt>最近心跳</dt><dd>{{ formatTime(nodeFor(role)?.lastSeen) }}</dd></div></dl><p v-if="nodeFor(role)?.health?.lastError" class="form-error">{{ nodeFor(role)?.health.lastError }}</p></article></div>
          <div class="control-row"><div><b>选择控制端</b><p>切换需等待旧授权结束与在途动作完成。暂停只停止新指令。</p></div><div class="button-row"><button v-for="role in roles" :key="role" class="secondary-button" :class="{ 'chosen-control': selected.control.role === role && !selected.control.draining }" :disabled="controlUnavailable || (selected.control.role === role && !selected.control.draining)" @click="changeControl(role)">切换至 {{ roleName(role) }}</button><button class="secondary-button" :disabled="controlUnavailable || (!selected.control.role && !selected.control.draining)" @click="changeControl(null)">暂停新指令</button></div></div>
          <p v-if="selected.control.draining" class="waiting-note" role="status">正在释放原控制端{{ selected.control.leaseExpiresAt ? `（授权截止：${formatTime(selected.control.leaseExpiresAt)}）` : '' }}。释放完成后即可重新切换控制端或提交升级。</p>
        </section>

        <section class="panel remote-panel" data-testid="remote-panel">
          <div class="panel-header"><div><h2>画面与操控</h2><p>画面为手机回传截图，不是实时视频。只向当前手机和控制端提交指令。</p></div><div class="button-row"><button class="secondary-button" :disabled="diagnosticUnavailable" @click="sendCommand('health')">检查健康</button><button class="secondary-button" :disabled="diagnosticUnavailable" @click="sendCommand('screenshot')">请求截图</button></div></div>
          <p v-if="commandBlockReason" class="waiting-note">{{ commandBlockReason }}</p>
          <div class="remote-grid"><div class="screen-column"><div class="phone-screen" :class="{ armed: manipulationEnabled && !commandUnavailable }"><img v-if="snapshotSrc" data-testid="device-snapshot" :src="snapshotSrc" :alt="`${selected.alias} 最近一次回传的手机截图`" draggable="false" :class="{ interactive: manipulationEnabled && !commandUnavailable }" @pointerdown="startGesture" @pointerup="finishGesture" @pointercancel="cancelGesture" @lostpointercapture="cancelGesture" /><div v-else class="screen-placeholder"><AppIcon name="device" :size="36" /><b>{{ currentSnapshot ? '截图格式不可用' : '尚未收到画面' }}</b><p>选择在线控制端后<br />点击“请求截图”获取画面</p></div></div><p class="snapshot-note">{{ currentSnapshot ? `截图时间 ${formatTime(currentSnapshot.capturedAt)} · ${currentSnapshot.width} × ${currentSnapshot.height}` : '只展示真实回传画面' }}</p></div><div class="remote-controls">
            <label class="enable-control"><input v-model="manipulationEnabled" data-testid="enable-manipulation" type="checkbox" :disabled="commandUnavailable" /><span><b>{{ manipulationEnabled ? '操控已启用' : '启用这台手机的操控' }}</b><small>启用后，画面手势和下方操作会真实作用于手机。</small></span></label>
            <fieldset :disabled="manipulationUnavailable"><legend>画面手势</legend><div class="gesture-options"><label><input v-model="gestureMode" type="radio" value="tap" />点击</label><label><input v-model="gestureMode" type="radio" value="swipe" />拖动滑动</label></div><label v-if="gestureMode === 'swipe'" class="form-field">滑动时长（毫秒）<input v-model.number="swipeDuration" type="number" min="1" max="2000" step="1" /></label><p class="control-hint">{{ gestureMode === 'tap' ? '在截图上单击发送点击。' : '在截图内按住并拖到终点，松开发送滑动。' }}坐标会按截图原始尺寸换算；屏幕变化后请重新截图。</p></fieldset>
            <form @submit.prevent="sendText"><label class="form-field">输入文字<textarea v-model="inputText" rows="3" maxlength="2000" :disabled="manipulationUnavailable" placeholder="将写入手机当前聚焦的输入框" /></label><button class="secondary-button" :disabled="manipulationUnavailable || !inputText.length">发送文字</button></form>
            <form class="inline-control-form" @submit.prevent="sendCommand('global', { key: globalKey })"><label class="form-field">系统操作<select v-model="globalKey" :disabled="manipulationUnavailable"><option value="back">返回</option><option value="home">主页</option><option value="recents">最近任务</option></select></label><button class="secondary-button" :disabled="manipulationUnavailable">执行</button></form>
            <form @submit.prevent="launchApp"><label class="form-field">打开应用<input v-model="packageName" :disabled="manipulationUnavailable" placeholder="应用包名，例如 com.example.app" /></label><button class="secondary-button" :disabled="manipulationUnavailable || !packageName.trim()">打开应用</button></form>
          </div></div>
        </section>

        <section class="panel history-panel" data-testid="command-history"><div class="panel-header"><div><h2>最新命令与回执</h2><p>提交不等于执行成功。结果未知的动作不能自动重发。</p></div><span class="muted">全部未解决 + 最近 20 条已结束</span></div><div v-if="!recentCommands.length" class="compact-message">这台手机尚无命令记录。</div><div v-else class="table-wrap"><table><thead><tr><th>动作 / 控制端</th><th>回执状态</th><th>结果</th><th>提交时间</th></tr></thead><tbody><tr v-for="command in recentCommands" :key="command.id"><td><b>{{ commandLabels[command.action] ?? command.action }}</b><small>{{ roleName(command.role) }} · {{ command.id }}</small></td><td><span class="state-tag" :class="stateClass(command.status)">{{ commandStatusLabels[command.status] ?? command.status }}</span></td><td class="command-result">{{ commandSummary(command) }}<details class="receipt-payload"><summary>查看完整回执</summary><pre>{{ commandReceipt(command) }}</pre></details><button v-if="command.status === 'uncertain'" class="text-link command-resolve-button" :disabled="controlUnavailable" @click="openCommandResolve(command)">核实并解除阻塞</button></td><td class="nowrap muted">{{ formatTime(command.createdAt) }}</td></tr></tbody></table></div></section>

        <section class="panel update-panel"><div class="panel-header"><div><h2>双端互相升级</h2><p>由对端安装目标包，安装包、证书摘要和版本都需校验。一个手机同时只能有一个升级事务。</p></div></div>
          <form class="update-form" data-testid="update-form" @submit.prevent="submitUpdate"><div v-if="repairUpdate" class="repair-notice"><b>提交更高版本修复包</b><p>将接替 {{ roleName(repairUpdate.targetRole) }} 的事务 {{ repairUpdate.id }}；versionCode 必须高于 {{ repairUpdate.versionCode }}。仅原安装已结束且目标健康失败时允许修复，安装中或等待手机授权的事务不能替换。服务器会核实条件。</p><button type="button" class="text-link" :disabled="busy" @click="replacesUpdateId = ''">退出修复准备</button></div><div class="two-fields"><label class="form-field">要升级的端点<select v-model="targetRole" :disabled="updateFormUnavailable || !!repairUpdate" @change="applyPublishedPackage"><option value="agent">Agent · com.ziwei.device.agent</option><option value="updater">Updater · com.ziwei.device.updater</option></select></label><label class="form-field">目标 versionCode<input v-model.number="versionCode" type="number" min="1" step="1" required :disabled="updateFormUnavailable" placeholder="必须高于当前版本" /></label></div><label v-if="publishedReleases.length" class="form-field">已发布安装包<select v-model="selectedReleaseKey" :disabled="updateFormUnavailable" @change="applyPublishedPackage"><option value="">手动填写路径</option><option v-for="release in publishedReleases" :key="`${release.versionName}-${release.versionCode}`" :value="`${release.versionName}-${release.versionCode}`">v{{ release.versionName }} · code {{ release.versionCode }} · {{ release.buildType }}</option></select><small>选择后自动填入安装包路径、SHA-256 和签名摘要。</small></label><label class="form-field">APK 安装包路径<input v-model="apkUrl" type="url" required :disabled="updateFormUnavailable" placeholder="https://服务器地址/downloads/android/.../app.apk" /><small>手机会直接访问这个 HTTPS 路径；后续发布新包后从这里选择，不用手工复制摘要。</small></label><div class="two-fields"><label class="form-field">APK SHA-256<input v-model="apkHash" class="mono" maxlength="64" minlength="64" pattern="[a-fA-F0-9]{64}" required :disabled="updateFormUnavailable" placeholder="64 位十六进制摘要" /></label><label class="form-field">签名证书 SHA-256<input v-model="signerHash" class="mono" maxlength="64" minlength="64" pattern="[a-fA-F0-9]{64}" required :disabled="updateFormUnavailable" placeholder="64 位十六进制摘要" /></label></div><p class="installer-note">安装执行端：{{ targetRole === 'agent' ? 'Updater' : 'Agent' }} · {{ syncError ? '状态待确认' : upgradeInstaller?.status === 'online' ? '在线' : '离线 / 未接入' }} · {{ healthValue(upgradeInstaller, 'canInstall', '可请求安装', '未授权安装') }}</p><p v-if="updateError" class="form-error" role="alert">{{ updateError }}</p><div class="update-submit"><p>提交前先读取手机画面；检查成功后才会下发升级。安装完成后仍需目标端新版本健康心跳才能验收。</p><button class="primary-button" :disabled="updateFormUnavailable">{{ repairUpdate ? '检查并提交修复包' : '检查并提交升级' }}</button></div></form>
          <div class="update-history"><h3>升级事务</h3><p v-if="!recentUpdates.length" class="compact-message">暂无升级事务。</p><article v-for="update in recentUpdates" :key="update.id" :data-testid="`update-${update.id}`" class="update-record"><div class="update-record-heading"><div><b>{{ roleName(update.targetRole) }} → versionCode {{ update.versionCode }}</b><small>由 {{ roleName(update.installerRole) }} 安装 · {{ formatTime(update.createdAt) }}</small></div><span class="state-tag" :class="stateClass(update.status)">{{ updateStatusLabels[update.status] ?? update.status }}</span></div><p v-if="update.status === 'awaiting_user_action'" class="waiting-note">手机会拉起系统安装页；已开启无障碍时，Agent / Updater 只会自动确认已校验的伙伴 APK。首次启用或系统拦截后台拉起时，需在手机上打开一次确认页。</p><p v-else-if="['installed', 'awaiting_health'].includes(update.status)" class="waiting-note">“安装已回报”还不代表升级完成，正在等待目标端的新版本及健康心跳。</p><p v-else-if="update.status === 'repair_required'" class="waiting-note">安装结果需要人工核实。先检查手机实际版本、运行状态与安装会话，再处理事务。</p><p v-if="update.error" class="form-error">{{ update.error }}</p><small class="mono update-id">{{ update.id }}</small><button v-if="['awaiting_health', 'repair_required'].includes(update.status)" class="text-link repair-button" :disabled="controlUnavailable" @click="prepareRepair(update)">准备修复版本</button><button v-if="!terminalUpdates.has(update.status)" class="text-link" :disabled="controlUnavailable" @click="openResolve(update)">{{ ['planned', 'downloading', 'verified'].includes(update.status) ? '处理 / 取消事务' : '人工核实并处理' }}</button></article></div>
        </section>
      </div>
    </div>

    <ModalDialog :busy="busy" v-if="showRegister" :title="credentials ? '保存双端接入凭证' : '登记手机'" :wide="!!credentials" @close="closeRegister">
      <form v-if="!credentials" @submit.prevent="registerDevice"><p class="modal-description">为同一台手机创建 Agent 与 Updater 两个独立身份。登记不会使设备自动在线，也不会操作手机。</p><label class="form-field">手机名称<input v-model="alias" data-testid="phone-alias" maxlength="80" required :disabled="busy" placeholder="例如：工作手机 01" /></label><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><div class="modal-actions"><button type="button" class="secondary-button" :disabled="busy" @click="closeRegister">取消</button><button class="primary-button" :disabled="busy">{{ busy ? '登记中…' : '登记并创建凭证' }}</button></div></form>
      <div v-else class="credential-content" data-testid="device-credentials"><p class="credential-warning">{{ credentials.device.alias }} 已登记。两个凭证只返回这一次，关闭后不会在列表中显示；请先分别保存，不要混用。</p><section v-for="role in roles" :key="role" class="credential-role"><div class="credential-role-heading"><b>{{ roleName(role) }}</b><button class="text-link" @click="copyCredential(role)">{{ copiedRole === role ? '已复制' : '复制凭证' }}</button></div><textarea :value="credentials.tokens[role]" readonly rows="2" :aria-label="`${roleName(role)} 一次性接入凭证`" spellcheck="false" /></section><label class="form-field">手机连接的 HTTPS 根地址<input v-model="credentialApiUrl" data-testid="credential-api-url" type="url" placeholder="https://你的接入域名" /><small>已填入本站地址；手机导入对应配置后即可连接。</small></label><div class="button-row"><button class="secondary-button" @click="downloadConfig('agent')">下载 Agent 配置</button><button class="secondary-button" @click="downloadConfig('updater')">下载 Updater 配置</button></div><p class="control-hint">配置包含端点凭证，请仅导入对应 APK 并妥善保存。apiUrl 为空的文件只保存身份，尚不能联网接入。</p><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><div class="modal-actions"><button class="primary-button" :disabled="busy" @click="closeRegister">关闭凭证窗口</button></div></div>
    </ModalDialog>

    <ModalDialog :busy="busy" v-if="resolveTarget" title="人工核实升级事务" @close="!busy && (resolveTarget = null)"><form @submit.prevent="resolveUpdate"><p class="modal-description">{{ selected?.alias }} · {{ roleName(resolveTarget.targetRole) }} · versionCode {{ resolveTarget.versionCode }}<br />当前状态：{{ updateStatusLabels[resolveTarget.status] ?? resolveTarget.status }}</p><label class="form-field">处理方式<select v-model="resolution" :disabled="busy"><option value="verified">已核实，请求服务器验证完成</option><option value="cancel">请求取消此事务</option></select></label><p v-if="resolution === 'verified'" class="waiting-note">请先在手机上核实目标包和运行状态。服务器还必须观察到目标新版本与健康心跳才会验收；人工确认不能直接宣称已安装。</p><p v-else class="waiting-note">安装提交前可请求取消计划。已经进入安装流程时，取消事务不等于卸载、回滚或中止系统安装；需先核实手机安装会话与实际结果，服务器可能拒绝取消。</p><label class="resolution-check"><input v-model="resolutionChecked" type="checkbox" :disabled="busy" /><span>我已核实此手机的安装进度、实际版本与运行状态，理解本次处理的含义。</span></label><p v-if="resolveError" class="form-error" role="alert">{{ resolveError }}</p><div class="modal-actions"><button type="button" class="secondary-button" :disabled="busy" @click="resolveTarget = null">返回</button><button class="primary-button" :disabled="busy || !resolutionChecked">{{ busy ? '处理中…' : '提交处理请求' }}</button></div></form></ModalDialog>
    <ModalDialog :busy="busy" v-if="commandResolveTarget" title="核实执行结果" @close="!busy && (commandResolveTarget = null)">
      <form @submit.prevent="resolveCommand">
        <p class="modal-description">{{ selected?.alias }} · {{ commandLabels[commandResolveTarget.action] }} · {{ roleName(commandResolveTarget.role) }}<br /><span class="mono">{{ commandResolveTarget.id }}</span></p>
        <p class="waiting-note">此命令的执行结果未知，动作可能已经发生。请先查看当前手机状态，必要时请求截图核实。此操作仅记录人工核实并解除阻塞，不会重放命令，也不会把原命令标为执行成功。原控制授权尚未结束时，请等候并再次提交。</p>
        <label class="form-field command-resolution-note">核实说明（必填）<textarea v-model="commandResolutionNote" data-testid="command-resolution-note" rows="4" maxlength="1000" required :disabled="busy" placeholder="请记录已核实的手机当前状态、动作是否发生，以及判断依据。" /></label>
        <p v-if="commandResolveError" class="form-error" role="alert">{{ commandResolveError }}</p>
        <div class="modal-actions"><button type="button" class="secondary-button" :disabled="busy" @click="commandResolveTarget = null">返回核实</button><button class="primary-button" :disabled="controlUnavailable || !commandResolutionNote.trim()">{{ busy ? '处理中…' : '已核实，解除阻塞' }}</button></div>
      </form>
    </ModalDialog>
  </div>
</template>

<style scoped>
.view-stack { display: grid; gap: 20px; }
.page-intro { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin: 0 0 4px; }
.page-intro h1 { margin: 0 0 10px; font-size: 24px; line-height: 1.35; font-weight: 600; letter-spacing: .2px; }
.page-intro p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
.primary-button, .secondary-button, .ghost-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 35px; padding: 8px 13px; border: 1px solid transparent; border-radius: 6px; font-size: 12px; font-weight: 500; line-height: 1.4; white-space: nowrap; }
.primary-button { color: #fff; background: var(--violet); border-color: var(--violet); }
.primary-button:hover:not(:disabled) { background: #574592; }
.secondary-button, .ghost-button { color: #5e6d72; border-color: var(--line-strong); background: #fff; }
.secondary-button:hover:not(:disabled), .ghost-button:hover:not(:disabled) { border-color: #a9bbb3; background: #f9fbfa; }
.text-link { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; color: var(--violet); background: none; font-size: 12px; line-height: 1.6; white-space: nowrap; }
.text-link:hover:not(:disabled) { text-decoration: underline; }
.panel { min-width: 0; padding: 22px; border: 1px solid var(--line); border-radius: var(--radius); background: #fff; }
.panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.panel-header h2 { margin: 0; font-size: 14px; font-weight: 600; }
.panel-header p { margin: 7px 0 0; font-size: 11px; color: #98a1a5; line-height: 1.6; }
.state-tag { display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px; border-radius: 4px; font-size: 10px; line-height: 1.7; white-space: nowrap; }
.state-tag.neutral, .state-tag.offline, .state-tag.idle, .state-tag.cancelled { color: #899498; background: #f0f3f4; }
.state-tag.online, .state-tag.succeeded { color: #317c62; background: #edf7f1; }
.state-tag.queued { color: #93835a; background: #f7f4eb; }
.state-tag.running { color: #397d9c; background: #edf5f9; }
.state-tag.failed, .state-tag.attention { color: #b36257; background: #fbefeb; }
.state-tag.uncertain { color: #a5792f; background: #fcf4e7; }
.work-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 260px; padding: 38px 22px; text-align: center; }
.work-empty > svg { margin-bottom: 15px; color: #a5b9af; }
.work-empty h3 { margin: 0 0 9px; font-size: 14px; font-weight: 500; color: #647670; }
.work-empty p { max-width: 395px; margin: 0 0 15px; color: #97a2a5; font-size: 11px; line-height: 1.9; }
.work-empty > small { margin-top: 10px; color: #a2abad; font-size: 10px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; text-align: left; font-size: 11px; }
th { padding: 13px 21px; color: #95a0a5; background: #fbfcfc; border-bottom: 1px solid var(--line); font-weight: 400; white-space: nowrap; }
td { padding: 16px 21px; border-bottom: 1px solid #eef1f2; line-height: 1.6; vertical-align: middle; }
td b { font-size: 12px; font-weight: 500; }
td small { display: block; color: #a0abad; margin-top: 4px; font-size: 10px; }
.connection-alert { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 12px 15px; border: 1px solid #f0d9d1; border-radius: 6px; color: #a36958; background: #fcf4ef; font-size: 11px; line-height: 1.8; }
.notice-strip { padding: 12px 15px; border: 1px solid #dfebe2; border-radius: 6px; color: #628470; background: #f3f9f5; font-size: 11px; line-height: 1.8; }
.loading-state { padding: 65px 25px; text-align: center; color: #96a1a4; }
.mono, code, pre { font-family: 'Cascadia Code', Consolas, monospace; }
.nowrap { white-space: nowrap; }
.modal-description { margin: 0 0 22px; color: #929fa2; font-size: 12px; line-height: 1.9; }
.form-field { display: grid; gap: 9px; margin: 0 0 19px; color: #677a73; font-size: 12px; }
.form-field input, .form-field select { width: 100%; min-width: 0; height: 38px; padding: 0 11px; border: 1px solid #dfe5e2; border-radius: 6px; background: #fff; color: #536a60; font-size: 12px; }
.form-field input::placeholder { color: #b0b9b5; }
.form-field input:disabled { background: #f7f9f8; color: #93a09a; }
.form-field small { color: #9aa7a1; font-size: 10px; }
.form-error { color: #ba685b; font-size: 11px; line-height: 1.8; }
.modal-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 9px; margin-top: 25px; padding-top: 18px; border-top: 1px solid var(--line); }
.android-devices-view { --ink: var(--ziwei-ink); --ink-soft: var(--ziwei-ink-soft); --muted: var(--ziwei-muted); --violet: var(--ziwei-violet); --violet-soft: var(--ziwei-violet-soft); --green: var(--ziwei-green); --line: var(--ziwei-line); --line-strong: var(--ziwei-line-strong); --radius: 10px; min-width: 0; }
.android-devices-view button { font-family: inherit; cursor: pointer; }
.android-devices-view button:disabled { cursor: not-allowed; opacity: .5; }
.android-devices-view h2, .android-devices-view h3 { color: var(--ink); }
.page-intro h2 { margin: 0 0 7px; font-size: 18px; font-weight: 600; }
.button-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.muted { color: var(--muted); }
.enrollment-panel .panel-header { margin-bottom: 14px; }
.enrollment-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 12px; }
.enrollment-actions small { color: var(--muted); }
.enrollment-outcomes { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 12px; color: var(--ink-soft); font-size: 12px; }
.enrollment-outcomes p { margin: 4px 0; overflow-wrap: anywhere; }
.enrollment-outcomes [data-status="approved"] { color: var(--green); }
.enrollment-item > div:first-child { min-width: 0; overflow-wrap: anywhere; }
.node-grid { margin-top: 18px; }
.form-field textarea, .credential-role textarea { box-sizing: border-box; }
@media (max-width: 600px) { .page-intro, .panel-header { flex-wrap: wrap; } .enrollment-actions { justify-content: flex-start; } .phone-options { grid-template-columns: minmax(0, 1fr); } .history-panel .panel-header > .muted { white-space: normal; } }

.connection-note { display: flex; gap: 13px; align-items: flex-start; padding: 17px 20px; }
.enrollment-panel { padding: 18px 20px; }
.enrollment-list { display: grid; gap: 10px; }
.enrollment-item { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px; border: 1px solid #e6e0f0; border-radius: 7px; background: #fcfbfe; }
.enrollment-item b { display: block; font-size: 12px; font-weight: 550; }
.enrollment-item small { display: block; margin-top: 5px; color: var(--muted); font-size: 10px; }
.connection-note > svg { color: var(--violet); flex-shrink: 0; margin-top: 2px; }
.connection-note > div { flex: 1; }
.connection-note strong { font-size: 12px; font-weight: 550; }
.connection-note p { margin: 6px 0 0; color: var(--ink-soft); font-size: 11px; line-height: 1.8; }
.device-workspace { display: grid; grid-template-columns: 225px minmax(0, 1fr); gap: 18px; align-items: start; }
.phone-list { padding: 18px 12px 14px; }
.phone-list .panel-header { padding: 0 7px 16px; }
.list-count { margin-left: 7px; color: var(--muted); font-size: 12px; }
.phone-options { display: grid; gap: 8px; }
.phone-option { display: block; width: 100%; padding: 12px 10px; border: 1px solid transparent; border-radius: 7px; background: #fff; color: var(--ink-soft); text-align: left; }
.phone-option:hover { background: #faf9fc; }
.phone-option.selected { background: var(--violet-soft); border-color: #ded7ef; }
.phone-option-title { display: flex; align-items: center; gap: 7px; }
.phone-option-title b { font-size: 12px; font-weight: 550; overflow-wrap: anywhere; }
.phone-option > small { display: block; margin: 8px 0 10px; font-size: 9px; color: var(--muted); overflow-wrap: anywhere; }
.phone-node-status { display: flex; flex-wrap: wrap; gap: 8px; font-size: 10px; }
.phone-node-status i { display: inline-block; width: 5px; height: 5px; margin-right: 4px; border-radius: 50%; background: #adb4b8; }
.phone-node-status i.online { background: var(--green); }
.sync-note { margin: 18px 7px 0; color: var(--muted); font-size: 10px; line-height: 1.8; }
.device-detail { display: grid; gap: 18px; min-width: 0; }
.device-heading { margin-bottom: 19px; }
.device-heading h2 { font-size: 16px; }
.device-heading p { overflow-wrap: anywhere; }
.device-heading-actions { display: flex; align-items: center; gap: 8px; }
.danger-button { border: 1px solid #e9caca; border-radius: 6px; padding: 7px 10px; color: #a13c3c; background: #fff8f8; font: inherit; font-size: 11px; cursor: pointer; }
.danger-button:hover:not(:disabled) { border-color: #d99b9b; background: #fff0f0; }
.danger-button:disabled { cursor: not-allowed; opacity: .55; }
.node-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
.node-card { padding: 14px; border: 1px solid var(--line); border-radius: 7px; }
.node-card header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.node-card header b { font-weight: 550; font-size: 13px; }
.version-line { margin: 8px 0 15px; color: var(--muted); font-size: 10px; }
.node-card dl { display: grid; gap: 10px; margin: 0; }
.node-card dl > div { display: flex; justify-content: space-between; gap: 9px; font-size: 10px; }
.node-card dt { color: var(--muted); }
.node-card dd { margin: 0; text-align: right; color: var(--ink-soft); }
.node-card .form-error { margin: 12px 0 0; overflow-wrap: anywhere; }
.control-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--line); }
.control-row b { font-size: 12px; font-weight: 550; }
.control-row p { margin: 7px 0 0; color: var(--muted); font-size: 10px; line-height: 1.8; }
.chosen-control { color: var(--violet); background: var(--violet-soft); border-color: #d9d0ee; }
.waiting-note { margin: 15px 0 0; padding: 10px 12px; border: 1px solid #eee3cf; border-radius: 6px; color: #97752e; background: #fffbf3; font-size: 11px; line-height: 1.85; }
.remote-grid { display: grid; grid-template-columns: minmax(180px, .9fr) minmax(210px, 1fr); gap: 23px; margin-top: 22px; }
.screen-column { align-self: start; text-align: center; }
.phone-screen { display: flex; align-items: center; justify-content: center; min-height: 300px; width: fit-content; max-width: 100%; min-width: min(240px, 100%); margin: 0 auto; padding: 6px; border: 1px solid var(--line-strong); border-radius: 15px; background: #f2f4f5; box-shadow: 0 4px 16px #26323808; }
.phone-screen.armed { border-color: var(--violet); box-shadow: 0 0 0 3px var(--violet-soft); }
.phone-screen img { display: block; max-width: 100%; max-height: 650px; width: auto; height: auto; border-radius: 9px; user-select: none; }
.phone-screen img.interactive { cursor: crosshair; touch-action: none; }
.screen-placeholder { display: grid; justify-items: center; align-content: center; gap: 15px; width: 230px; min-height: 360px; padding: 20px; color: #a3adb3; }
.screen-placeholder b { color: var(--ink-soft); font-size: 12px; font-weight: 500; }
.screen-placeholder p { margin: 0; font-size: 11px; line-height: 1.9; }
.snapshot-note { margin: 12px 0 0; color: var(--muted); font-size: 10px; line-height: 1.8; }
.remote-controls { display: grid; align-content: start; gap: 18px; min-width: 0; }
.enable-control { display: flex; align-items: flex-start; gap: 8px; padding: 12px; border: 1px solid #e6e0f0; border-radius: 6px; background: #faf8fd; }
.enable-control input { margin: 1px 0 0; accent-color: var(--violet); }
.enable-control b { display: block; color: var(--violet); font-size: 12px; font-weight: 550; }
.enable-control small { display: block; margin-top: 6px; color: var(--ink-soft); font-size: 10px; line-height: 1.7; }
fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
legend { padding: 0; margin-bottom: 10px; color: var(--ink-soft); font-size: 12px; }
.gesture-options { display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 12px; font-size: 11px; }
.gesture-options label { display: inline-flex; align-items: center; gap: 5px; }
.gesture-options input { accent-color: var(--violet); }
.control-hint { margin: 9px 0 0; color: var(--muted); font-size: 10px; line-height: 1.8; }
.remote-controls .form-field { margin-bottom: 9px; }
.remote-controls form + form { padding-top: 17px; border-top: 1px solid var(--line); }
.inline-control-form { display: flex; align-items: flex-end; gap: 8px; }
.inline-control-form .form-field { flex: 1; margin: 0; }
.form-field textarea, .credential-role textarea { width: 100%; padding: 10px 11px; border: 1px solid var(--line-strong); border-radius: 6px; background: #fff; color: var(--ink-soft); font-size: 12px; line-height: 1.7; resize: vertical; }
textarea:focus-visible { outline: 3px solid #b2d8c8; outline-offset: 2px; }
.form-field textarea:disabled { background: #f7f9f8; }
.history-panel { padding: 20px 0 0; overflow: hidden; }
.history-panel > .panel-header { padding: 0 20px 18px; }
.history-panel .panel-header > .muted { font-size: 10px; white-space: nowrap; }
.history-panel td { vertical-align: top; }
.history-panel td small { overflow-wrap: anywhere; max-width: 160px; }
.receipt-payload { margin-top:8px; }
.receipt-payload summary { color:var(--violet); cursor:pointer; font-size:11px; }
.receipt-payload pre { max-width:400px; max-height:320px; overflow:auto; padding:10px; border:1px solid var(--line); border-radius:6px; background:var(--ziwei-canvas); white-space:pre-wrap; overflow-wrap:anywhere; font-size:10px; }
.command-result { max-width: 230px; min-width: 140px; color: var(--ink-soft); overflow-wrap: anywhere; font-size: 10px; }
.command-resolve-button { display: block; margin-top: 8px; }
.command-resolution-note { margin-top: 17px; }
.compact-message { padding: 25px 20px; margin: 0; color: var(--muted); font-size: 11px; text-align: center; }
.update-form { margin-top: 22px; }
.repair-notice { margin-bottom: 20px; padding: 13px; border: 1px solid #eee3cf; border-radius: 6px; color: #97752e; background: #fffbf3; }
.repair-notice b { font-size: 12px; font-weight: 550; }
.repair-notice p { margin: 7px 0 9px; font-size: 11px; line-height: 1.8; overflow-wrap: anywhere; }
.repair-button { margin-right: 16px; }
.two-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px; }
.update-form .form-field small { line-height: 1.7; }
.installer-note { margin: -2px 0 15px; color: var(--ink-soft); font-size: 11px; line-height: 1.8; }
.update-submit { display: flex; justify-content: space-between; align-items: center; gap: 20px; }
.update-submit p { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.8; }
.update-history { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); }
.update-history h3 { margin: 0 0 16px; font-size: 12px; font-weight: 550; }
.update-record { padding: 14px; border: 1px solid var(--line); border-radius: 6px; }
.update-record + .update-record { margin-top: 11px; }
.update-record-heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.update-record-heading b { font-size: 12px; font-weight: 550; }
.update-record-heading small { display: block; margin-top: 7px; color: var(--muted); font-size: 10px; }
.update-record .form-error { margin: 12px 0; overflow-wrap: anywhere; }
.update-id { display: block; margin: 12px 0; color: var(--muted); font-size: 9px; overflow-wrap: anywhere; }
.credential-warning { margin: 0 0 18px; padding: 12px; border-radius: 6px; background: #fff8ec; color: #957029; font-size: 12px; line-height: 1.8; }
.credential-role { margin-bottom: 18px; }
.credential-role-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
.credential-role-heading b { font-size: 12px; font-weight: 550; }
.credential-role textarea { font-family: 'Cascadia Code', Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; background: #fafbfc; }
.credential-content .form-field small { line-height: 1.8; }
.resolution-check { display: flex; align-items: flex-start; gap: 8px; margin-top: 18px; color: var(--ink-soft); font-size: 11px; line-height: 1.8; }
.resolution-check input { margin: 3px 0 0; accent-color: var(--violet); }
@media (max-width: 1200px) { .device-workspace { grid-template-columns: 190px minmax(0, 1fr); gap: 14px; } .remote-grid { grid-template-columns: minmax(150px, 1fr) minmax(180px, 1fr); gap: 16px; } .device-detail > .panel { padding: 18px; } .device-detail > .history-panel { padding: 18px 0 0; } .phone-screen { min-width: 0; } .screen-placeholder { width: 180px; } }
@media (max-width: 980px) { .device-workspace { grid-template-columns: minmax(0, 1fr); } .phone-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); } .phone-list .panel-header { padding-bottom: 11px; } .sync-note { margin-top: 10px; } .sync-note br { display: none; } .phone-screen { min-width: 200px; } }
@media (max-width: 600px) { .page-intro { flex-wrap: wrap; } .connection-note > .state-tag { display: none; } .node-grid, .remote-grid, .two-fields { grid-template-columns: minmax(0, 1fr); } .remote-panel > .panel-header { flex-wrap: wrap; } .phone-screen img { max-height: 520px; } .remote-controls { margin-top: 6px; } .device-heading, .update-record-heading, .enrollment-item { flex-wrap: wrap; } .update-submit { align-items: flex-start; flex-direction: column; gap: 12px; } .phone-options { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
