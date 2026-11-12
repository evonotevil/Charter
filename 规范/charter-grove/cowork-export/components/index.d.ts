// Charter 组件属性（文档用，不做类型检查）
type Status = "ok" | "active" | "done" | "held" | "verified" | "soon" | "progress" | "review" | "conflict" | "overdue" | "expired" | "todo" | "missing" | "na" | "offline" | "device";
type Tone = "green" | "blue" | "purple" | "amber" | "neutral";
export interface IconProps { name: string; size?: number; label?: string }
export interface ButtonProps { variant?: "primary" | "secondary" | "quiet" | "danger"; size?: "md" | "sm"; icon?: string; label?: string; loading?: boolean; disabled?: boolean; onClick?: () => void; children?: React.ReactNode }
export interface AvatarProps { text: string; tone?: Tone; size?: number; round?: boolean; label?: string }
export interface StatusPillProps { status: Status; children?: React.ReactNode; title?: string }
export interface SidebarProps { items: { key: string; label: string; icon: string; badge?: number; badgeTone?: "bad" }[]; more?: SidebarProps["items"]; active?: string; org?: string; orgMeta?: string; user?: string }
export interface AppBarProps { context?: string; date?: string; offline?: boolean }
export interface PageHeadingProps { crumb?: string; title: string; subtitle?: string; actions?: React.ReactNode[] }
export interface HealthBannerProps { tone?: "ok" | "warn" | "bad"; icon?: string; title: string; body: string; segments?: ("ok" | "warn" | "bad")[]; segmentsLabel?: string; animateSegments?: boolean; foot?: string; action?: React.ReactNode; wiggle?: boolean }
export interface ProgressSegmentsProps { segments: ("ok" | "warn" | "bad")[]; label: string; animate?: boolean }
export interface MetricTileProps { value: string | number; icon?: string; label: string; hint?: string; tone?: "warn" | "bad"; button?: boolean; onClick?: () => void }
export interface SearchFieldProps { placeholder: string; value?: string }
export interface FieldProps { label: string; value?: string; placeholder?: string; options?: string[]; hint?: string; detected?: string; error?: string }
export interface ViewToggleProps { value?: "list" | "cards" }
export interface TabsProps { label: string; items: { key: string; label: string; count?: number }[]; value?: string }
export interface CardProps { title?: string; link?: string; action?: React.ReactNode; badge?: React.ReactNode; tone?: "amber" | "attention"; flush?: boolean; children?: React.ReactNode }
export interface EntityTableProps { rows: { code: string; tone?: Tone; name: string; reg: string; place: string; registry: string; status: Status; statusText?: string; next: string; nextWhat: string; agent?: string; agentName?: string; selected?: boolean }[] }
export interface EntitySnapshotProps { registry?: Status; compliance?: Status; complianceText?: string; complete: number; agent: string }
export interface FactGridProps { source?: string; items: { label: string; value?: string; note?: string }[] }
export interface PeopleTableProps { rows: { name: string; initial: string; tone?: Tone; roles: { title: string; since: string }[]; percent?: number }[] }
export interface DocumentListProps { items: { name: string; meta: string; status?: Status; statusText?: string }[] }
export interface NextUpCardProps { days: number; title: string; why: string; due: string; meta?: string[]; action?: string }
export interface HorizonListProps { items: { date: string; title: string; meta: string }[] }
export interface AuditNoteProps { title?: string; body?: string }
export interface InfoNoteProps { title: string; icon?: string; children: React.ReactNode }
export interface DeviceRowProps { kind?: "mac" | "windows"; name: string; status: Status; system: string; syncText: string; pending?: boolean; note?: string }
export interface ToggleProps { label: string; hint?: string; checked?: boolean }
export interface ChoiceCardProps { checked?: boolean; source: string; value: string; note?: string; onClick?: () => void }
export interface ActivityListProps { items: { text: string; time: string; icon?: string }[] }
export interface StructureChartProps { nodes: { id: string; name: string; kind?: "entity" | "person"; meta?: string; tone?: Tone; level: number }[]; edges: { from: string; to: string; label: string }[]; width?: number; selected?: string; animate?: boolean; replay?: boolean }
export interface FilingTimelineProps { groups: { label: string; items: { date?: string; days?: number; title: string; company: string; authority: string; status: Status }[] }[]; onDone?: () => void }
export interface CelebrationProps { title: string; body: string; icon?: string; action?: React.ReactNode; replay?: boolean }
export interface DropZoneProps { title?: string; hint?: string; active?: boolean }
export interface UploadRowProps { name: string; simulate?: boolean; recognized?: { type: string; summary: string } }
export interface ProcessStepsProps { steps: { label: string; result?: string }[]; simulate?: boolean }
export interface EmptyStateProps { title: string; body: string; icon?: string; action?: React.ReactNode }
export interface ToastProps { icon?: string; actionLabel?: string; children: React.ReactNode }
export interface DialogProps { title: string; actions: React.ReactNode[]; children: React.ReactNode }
