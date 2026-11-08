import EntryListEditor,{nonemptyEntries} from './EntryListEditor'

// Repeating the same care step can be intentional: do not deduplicate steps.
export const serviceSteps=nonemptyEntries

export default function StepListEditor(props:{value:string[];onChange:(value:string[])=>void;disabled?:boolean}){
  return <EntryListEditor {...props} className="step-list-editor" label="养护步骤" unit="步" addLabel="添加步骤" batchLabel="养护步骤（一行一步）" placeholder="填写这一步的养护内容" hint="每行一个步骤，按回车添加下一步；可用 ＋、− 增减和箭头调整顺序。修改后请保存，空白步骤会在保存时移除。"/>
}
