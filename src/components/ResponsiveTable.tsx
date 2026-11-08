import {Children, cloneElement, isValidElement, type ReactElement, type ReactNode, type TableHTMLAttributes, type TdHTMLAttributes} from 'react'

type Element = ReactElement<{children?: ReactNode; role?: string}>
const text = (node: ReactNode): string => Children.toArray(node).map(child =>
  isValidElement<{children?: ReactNode}>(child) ? text(child.props.children) : String(child)
).join('')

/** Preserve a semantic desktop table and pair each cell with its heading on phones. */
export default function ResponsiveTable({children, className = '', ...props}: TableHTMLAttributes<HTMLTableElement>) {
  const sections = Children.toArray(children)
  const head = sections.find(child => isValidElement(child) && child.type === 'thead') as Element | undefined
  const headingRow = head && Children.toArray(head.props.children).find(child => isValidElement(child) && child.type === 'tr') as Element | undefined
  const headings = headingRow ? Children.toArray(headingRow.props.children).map(text) : []
  return <table {...props} role="table" className={`responsive-table ${className}`}>
    {sections.map(section => {
      if (!isValidElement<{children?: ReactNode; role?: string}>(section) || section.type !== 'tbody') return section
      return cloneElement(section, {role: 'rowgroup', children: Children.map(section.props.children, row => {
        if (!isValidElement<{children?: ReactNode; role?: string}>(row) || row.type !== 'tr') return row
        return cloneElement(row, {role: 'row', children: Children.toArray(row.props.children).map((cell, index) => {
          if (!isValidElement<TdHTMLAttributes<HTMLTableCellElement>>(cell) || cell.type !== 'td') return cell
          return cloneElement(cell, {role: 'cell', 'data-label': headings[index] || undefined,
            children: <div className="responsive-cell-content">{cell.props.children}</div>} as TdHTMLAttributes<HTMLTableCellElement>)
        })})
      })})
    })}
  </table>
}
