/**
 * <Sensitive> — wraps content that should be blurred in demo mode.
 *
 * Usage:
 *   <Sensitive>{dollar amount / customer name / phone / etc.}</Sensitive>
 *
 * Works via CSS: .demo-mode [data-sensitive] { filter: blur(8px) }
 * No JS re-render needed — toggling the root class handles everything.
 */
export function Sensitive({
  children,
  className = '',
  as: Tag = 'span',
}: {
  children: React.ReactNode
  className?: string
  as?: keyof React.JSX.IntrinsicElements
}) {
  const El = Tag as React.ElementType
  return (
    <El data-sensitive className={className}>
      {children}
    </El>
  )
}
