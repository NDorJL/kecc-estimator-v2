export default function CalendarPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="text-4xl mb-4">📅</div>
      <h2 className="text-xl font-bold mb-2">Service Calendar</h2>
      <p className="text-muted-foreground text-sm max-w-xs">
        Schedule and manage jobs by date. Coming in Phase 2 — jobs and subscriptions will appear here with drag-and-drop rescheduling.
      </p>
    </div>
  )
}
