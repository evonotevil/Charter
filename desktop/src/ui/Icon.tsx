// SF Symbols 名称到 Lucide 图标的映射：沿用 Swift 版的图标命名，界面代码可以逐行对照移植。

import {
  AlertCircle, AlertOctagon, AlertTriangle, Archive, ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight,
  BadgeCheck, Bell, BellRing, Building2, Calendar, CalendarClock, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  ChevronsUpDown, ChevronUp, Circle, CircleDashed, Clock, ClockAlert, Cloud, CloudAlert, CloudOff, Copy, Ellipsis,
  ExternalLink, File, FileSearch, FileText, Folder, GitBranch, Grid3x3, Hammer, Hand, HardDrive, HelpCircle, Hourglass, Inbox,
  Info, Landmark, Laptop, LayoutGrid, Layers, ListChecks, ListTodo, Lock, Mail, MessageSquareText, Minus, MinusCircle, Network,
  Package, PackageOpen, Paperclip, Pencil, PencilLine, Plus, PlusCircle, PlusSquare, RefreshCw, RefreshCcwDot, RotateCcw, Search,
  Send, Settings, SlidersHorizontal, Square, Table2, Tag, Trash2, Upload, UserCircle, UserPlus, Users, Workflow, X, XCircle,
  type LucideIcon, Play, Pause, User, PieChart, FileClock, CalendarPlus, Bot, IdCard, History, ShieldQuestion, Download, GitFork, FileDown, ListTree,
} from "lucide-react";

const map: Record<string, LucideIcon> = {
  "play.fill": Play, "pause.fill": Pause, "lock.fill": Lock, exclamationmark: AlertCircle, questionmark: HelpCircle,
  plus: Plus, checkmark: Check, "exclamationmark.triangle.fill": AlertTriangle, "exclamationmark.triangle": AlertTriangle,
  magnifyingglass: Search, "doc.on.doc": Copy, ellipsis: Ellipsis, "building.2": Building2, trash: Trash2,
  "square.and.arrow.down": ArrowDownToLine, envelope: Mail, "checkmark.circle.fill": CheckCircle2, "xmark.circle.fill": XCircle,
  xmark: X, shippingbox: Package, "shippingbox.fill": PackageOpen, pencil: Pencil, "arrow.triangle.2.circlepath": RefreshCw,
  "square.stack.3d.up": Layers, paperplane: Send, minus: Minus, hourglass: Hourglass, "chevron.right": ChevronRight,
  calendar: Calendar, "arrow.uturn.backward": RotateCcw, "tray.and.arrow.down": Inbox, "square.and.arrow.up": Upload,
  "point.3.connected.trianglepath.dotted": Network, "person.2": Users, "minus.circle": MinusCircle, folder: Folder,
  "doc.text.magnifyingglass": FileSearch, "clock.arrow.circlepath": History, "chevron.left": ChevronLeft, checklist: ListChecks,
  "arrow.up.forward.app": ExternalLink, "xmark.circle": XCircle, "square.and.pencil": PencilLine, "questionmark.circle": HelpCircle,
  paperclip: Paperclip, "info.circle": Info, gearshape: Settings, clock: Clock, "chevron.up.chevron.down": ChevronsUpDown,
  "chevron.down": ChevronDown, "chevron.up": ChevronUp, "checkmark.seal": BadgeCheck, "building.columns": Landmark,
  "arrow.up.right": ArrowUpRight, "arrow.up": ArrowUp, "arrow.right": ArrowRight, "arrow.down.doc": FileDown, "arrow.down": ArrowDown,
  archivebox: Archive, "xmark.octagon.fill": AlertOctagon, tray: Inbox, "text.bubble": MessageSquareText, tag: Tag,
  tablecells: Table2, "slider.horizontal.3": SlidersHorizontal, "rectangle.3.group": LayoutGrid, "questionmark.diamond": ShieldQuestion,
  "plus.square": PlusSquare, "plus.circle": PlusCircle, "person.text.rectangle": IdCard, "person.crop.rectangle.stack": IdCard,
  "person.crop.circle": UserCircle, "person.badge.plus": UserPlus, "lock.circle": Lock, "list.bullet.rectangle": ListTodo,
  laptopcomputer: Laptop, "hand.point.up.left": Hand, hammer: Hammer, "exclamationmark.circle.fill": AlertCircle,
  "doc.richtext": FileText, "doc.fill": File, "doc.text": FileText, "clock.badge.exclamationmark": ClockAlert, "circle.fill": Circle,
  "circle.dashed": CircleDashed, "calendar.badge.clock": CalendarClock, "bell.badge": BellRing, bell: Bell,
  "arrow.triangle.branch": GitBranch, "arrow.clockwise": RotateCcw, "square.grid.3x3": Grid3x3, "doc.on.doc.fill": Copy,
  icloud: Cloud, "checkmark.icloud": Cloud, "exclamationmark.icloud": CloudAlert, "xmark.icloud": CloudOff,
  "arrow.triangle.2.circlepath.icloud": RefreshCcwDot, internaldrive: HardDrive, "square.grid.2x2": LayoutGrid,
  "arrow.down.circle": Download, sparkles: Bot, "arrow.triangle.merge": GitFork, "list.bullet.indent": ListTree,
  "person.2.fill": Users, workflow: Workflow, square: Square, "arrow.left": ArrowLeft,
  "icloud.fill": Cloud, "folder.fill": Folder, "person.fill": User, "chart.pie": PieChart, "doc.badge.clock": FileClock, "calendar.badge.plus": CalendarPlus,
};

export function Icon({ name, size = 15, strokeWidth = 2, className, style }: { name: string; size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }) {
  const C = map[name] ?? Circle;
  return <C size={size} strokeWidth={strokeWidth} className={className} style={style} fill={name === "play.fill" || name === "pause.fill" ? "currentColor" : "none"} aria-hidden />;
}
