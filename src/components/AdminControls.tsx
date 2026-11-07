import {Children, isValidElement, useRef, useState, type ButtonHTMLAttributes, type ChangeEvent, type FieldsetHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes} from 'react'
import {Button, Checkbox, ConfigProvider, Input, Select, type InputProps} from 'antd'

/** Keep existing form handlers while rendering all admin controls with Ant Design. */
type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {layout?: 'action' | 'card'}
export function ActionButton({type, layout = 'action', className = '', children, color: _color, ...props}: ActionButtonProps) {
  // Interactive cards keep their document layout; Ant Design buttons size actions.
  if (layout === 'card') return <button {...props} type={type || 'button'} className={className}>{children}</button>
  const variant = className.includes('a-primary') ? 'primary' : className.includes('a-link') ? 'link' : className.includes('a-secondary') || className.includes('a-danger') ? 'default' : 'text'
  return <Button {...props} htmlType={type || 'submit'} type={variant} danger={className.includes('a-danger')} className={className}>{children}</Button>
}

export function TextInput({type = 'text', size: _size, value, defaultValue, ...props}: InputHTMLAttributes<HTMLInputElement>) {
  if (type === 'file') return <input {...props} type="file"/>
  if (type === 'checkbox') {
    const {onChange, checked, defaultChecked, className, ...rest} = props
    return <Checkbox {...rest} checked={checked} defaultChecked={defaultChecked} className={className} onChange={event => onChange?.(event as unknown as ChangeEvent<HTMLInputElement>)}/>
  }
  const shared: InputProps = {...props, value: Array.isArray(value) ? value.join(',') : value, defaultValue: Array.isArray(defaultValue) ? defaultValue.join(',') : defaultValue}
  return type === 'password' ? <Input.Password {...shared}/> : <Input {...shared} type={type}/>
}

type Option = {value: string; label: ReactNode; disabled?: boolean}
export function SelectInput({children, value, defaultValue, onChange, required, disabled, className = '', name, id, 'aria-label': ariaLabel}: SelectHTMLAttributes<HTMLSelectElement>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<React.ComponentRef<typeof Select>>(null)
  const options: Option[] = []
  Children.forEach(children, child => {
    if (!isValidElement<{value?: string | number; children?: ReactNode; disabled?: boolean}>(child)) return
    options.push({value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, disabled: child.props.disabled})
  })
  const selected = value === undefined ? undefined : String(value)
  return <span className={`admin-select ${className}`}>
    <Select ref={ref} id={id} aria-label={ariaLabel} classNames={{root:'admin-select-control',popup:{root:'admin-select-popup'}}} value={selected} defaultValue={defaultValue === undefined ? undefined : String(defaultValue)} options={options} virtual={options.length > 100} disabled={disabled} open={open} onOpenChange={setOpen} onChange={next => {
      const target = {value: next, name: name || ''}
      onChange?.({target, currentTarget: target} as ChangeEvent<HTMLSelectElement>)
    }}/>
    {required && <input className="select-validation" tabIndex={-1} aria-hidden="true" required disabled={disabled} value={selected || ''} onChange={() => {}} onInvalid={event => {event.preventDefault(); ref.current?.focus(); setOpen(true)}}/>}
  </span>
}

export function TextArea({rows = 2, ...props}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Input.TextArea {...props} autoSize={{minRows: rows, maxRows: 12}}/>
}

export function DisabledFieldset({disabled,children,...props}:FieldsetHTMLAttributes<HTMLFieldSetElement>){
  return <fieldset {...props} disabled={disabled}><ConfigProvider componentDisabled={disabled}>{children}</ConfigProvider></fieldset>
}
