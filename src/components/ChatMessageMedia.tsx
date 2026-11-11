import {Image} from 'antd'
import {Download,Video} from 'lucide-react'
import type {Row} from '../types'
import '../chat-media.css'

export const attachmentSize=(size:number)=>size>=1024*1024?`${(size/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.ceil(size/1024))} KB`
const mediaUrl=(value:unknown)=>typeof value==='string'&&value.startsWith('/api/chat-media/')?value:''

export default function ChatMessageMedia({message}:{message:Row}){
  const attachment=message.attachment,url=mediaUrl(attachment?.url)
  if(!url)return <p>{message.content}</p>
  return <div className={`chat-message-media ${message.kind}`}>
    {message.kind==='image'?<Image src={url} alt={attachment.name||'聊天图片'} preview={{cover:'点击查看大图',motionName:''}}/>:<video src={url} poster={mediaUrl(attachment.thumbnailUrl)||undefined} controls playsInline preload='metadata' aria-label={attachment.name||'聊天视频'}/>}
    <div className='chat-media-caption'><span>{message.kind==='video'&&<Video size={14}/>}<strong>{attachment.name}</strong>{attachment.size>0&&<small>{attachmentSize(attachment.size)}</small>}</span><a href={url} download={attachment.name} aria-label={`下载${attachment.name}`}><Download size={15}/><span>下载</span></a></div>
  </div>
}

export async function videoThumbnail(url:string):Promise<Blob|undefined>{
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto'
  try{
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Video thumbnail timed out')),8000)
      video.onloadeddata=()=>{clearTimeout(timer);resolve()};video.onerror=()=>{clearTimeout(timer);reject(new Error('Video thumbnail unavailable'))};video.src=url
    })
    const canvas=document.createElement('canvas');canvas.width=Math.min(480,video.videoWidth);canvas.height=Math.max(1,Math.round(canvas.width*video.videoHeight/video.videoWidth))
    canvas.getContext('2d')?.drawImage(video,0,0,canvas.width,canvas.height)
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.6))
    return blob&&blob.size<=64*1024?blob:undefined
  }catch{return undefined}finally{video.removeAttribute('src');video.load()}
}
