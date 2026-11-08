import EntryListEditor,{uniqueEntries} from './EntryListEditor'

export const closedDates=uniqueEntries
export function invalidClosedDate(values:string[]){
  return closedDates(values).find(value=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return true
    const date=new Date(`${value}T00:00:00Z`)
    return !Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value
  })
}

export default function ClosedDatesEditor(props:{value:string[];onChange:(value:string[])=>void;disabled?:boolean}){
  return <EntryListEditor {...props} className="closed-dates-editor" label="休店日期" unit="个日期" addLabel="添加日期" batchLabel="休店日期（每行一个，或用逗号分隔）" type="date" reorder={false} separator={/\r\n|[\r\n,，]/} hint="点击 ＋ 添加、− 删除，可逐个选择日期，也可粘贴多条。保存预约规则后生效，空行和重复日期会在保存时移除。"/>
}
