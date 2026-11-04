import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BatteryFull, Check, ChevronDown, ChevronRight, CircleCheck, Clock3, Ellipsis, Flame, HeartHandshake, House, Leaf, MapPin, MessageCircle, Navigation, Phone, Plus, Signal, Sparkles, Wifi, X } from 'lucide-react'
import BookingFlow, {MyOrders} from './BookingFlow'
import type { ProductItem, ServiceItem, Site, StoreItem } from './types'

type Route = { page: string; id?: string }
type Props = { site: Site; compact?: boolean; initialPage?: string }

function Brand({ small = false, name = '裕和堂', english = 'YU HE TANG' }: { small?: boolean; name?: string; english?: string }) {
  return <div className={`brand-lockup ${small ? 'small' : ''}`}><span className="brand-seal">裕<br/>和</span><div><strong>{name}</strong><span>{english}</span></div></div>
}
export { Brand }

export default function MiniProgram({ site, compact = false, initialPage = 'home' }: Props) {
  const [route, setRoute] = useState<Route>({ page: initialPage })
  const [previous, setPrevious] = useState<Route>({ page: 'home' })
  const [serviceCategory, setServiceCategory] = useState('全部')
  const [district, setDistrict] = useState('全部区域')
  const [galleryGroup, setGalleryGroup] = useState(0)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [contact, setContact] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const services = site.services.filter(item => item.enabled)
  const stores = site.stores.filter(item => item.enabled)
  const products = site.products.filter(item => item.enabled)
  const [bookingContext, setBookingContext] = useState({serviceId:'',storeId:''})

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });  }, [route])
  const go = (page: string, id?: string) => { setPrevious(route); setRoute({ page, id }) }
  const book = (serviceId?: string, storeId?: string) => {
    setBookingContext({serviceId:serviceId || '',storeId:storeId || ''})
    go('booking')
  }
  const activeService = services.find(item => item.id === route.id)
  const activeStore = stores.find(item => item.id === route.id)
  const activeProduct = products.find(item => item.id === route.id)

  const sectionHeading = (eyebrow: string, title: string, action?: () => void) => <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action && <button className="text-link" onClick={action}>探索更多<ArrowRight size={15}/></button>}</div>
  const serviceCard = (item: ServiceItem) => <button key={item.id} className="service-card" onClick={() => go('service', item.id)}><div className="service-image"><img src={item.image} alt={item.name} loading="lazy"/><span>{item.tag}</span></div><div className="service-card-copy"><h3>{item.name}</h3><p>{item.subtitle}</p><div><span><Clock3 size={11}/>{item.duration}</span><ArrowRight size={18}/></div></div></button>
  const storeCard = (item: StoreItem) => <button className="store-card" key={item.id} onClick={() => go('store', item.id)}><img src={item.image} alt={item.name} loading="lazy"/><div><span className="store-tag">{item.district} · {item.tag}</span><h3>裕和堂 · {item.name}</h3><p><Clock3 size={12}/>{item.hours}<span className="store-details-link">门店详情<ChevronRight size={13}/></span></p></div></button>

  const homeSections: Record<string, React.ReactNode> = {
    services: <section className="mini-section">{sectionHeading('THE ART OF CARE', '从一场放松开始', () => go('services'))}<div className="service-grid">{services.slice(0, 2).map(serviceCard)}</div><div className="care-note"><HeartHandshake size={16}/><span>一人一方关照，从了解您的需要开始</span></div></section>,
    space: <section className="mini-section space-section">{sectionHeading('A PLACE TO SLOW DOWN', '一店一境，自在有和', () => go('spaces'))}<button className="space-feature" onClick={() => go('spaces')}><img src={site.stores.find(item => item.enabled)?.image || site.hero.image} alt="裕和堂真实门店空间" loading="lazy"/><span className="space-caption"><span>隐于城市，归于身心</span><span>走进裕和堂<ArrowRight size={17}/></span></span></button><div className="space-statement"><span>一盏茶的从容</span><span>一段身心的留白</span><span>一份细致的关照</span></div></section>,
    products: <section className="mini-section products-section">{sectionHeading('FROM NATURE, WITH CARE', '东方好物，日常之选', () => go('products'))}<div className="product-grid">{products.map(item => <button className="product-card" key={item.id} onClick={() => go('product', item.id)}><div><img src={item.image} alt={item.name} loading="lazy"/></div><span>{item.category}</span><h3>{item.name}</h3><p>{item.subtitle}</p></button>)}</div></section>,
    brand: <section className="brand-story mini-section"><span className="eyebrow">OUR PHILOSOPHY</span><h2>以艾为媒<br/>以和为本</h2><p>{site.brandStory}</p><button className="text-link" onClick={() => go('brand')}>关于裕和堂<ArrowRight size={15}/></button><span className="brand-story-mark">和</span></section>,
  }

  const rootPage = ['home', 'services', 'stores', 'booking'].includes(route.page)
  return <div className={`mini-program theme-${site.theme} ${compact ? 'compact' : ''}`}>
    <div className="mini-statusbar"><span>9:41</span><div><Signal size={13}/><Wifi size={13}/><BatteryFull size={17}/></div></div>
    <header className={`mini-header ${route.page === 'home' ? 'home-header' : ''}`}>
      {route.page === 'home' ? <Brand small name={site.brandName} english={site.brandEnglish}/> : <><button aria-label="返回" className="mini-back" onClick={() => rootPage ? go('home') : setRoute(previous.page === route.page ? { page: 'home' } : previous)}><ArrowLeft size={19}/></button><span>{({ services: '特色养护', service: '养护详情', stores: '城市门店', store: '走进门店', spaces: '一店一境', products: '东方好物', product: '好物详情', booking: '预约好时光', success: '预约已收到', brand: '关于裕和堂' } as Record<string, string>)[route.page]}</span></>}
      <div className="wechat-capsule"><Ellipsis size={19}/><i/><span>◉</span></div>
    </header>

    <div className="mini-scroll" ref={scrollRef}>
      {route.page === 'home' && <><button className='home-orders' onClick={()=>go('orders')}>我的预约申请 <ChevronRight size={13}/></button>
        <section className="mini-hero" style={{ backgroundImage: `url("${site.hero.image}")` }}><div className="hero-shade"/><div className="hero-copy"><span className="hero-eyebrow">{site.hero.eyebrow}</span><h1>{site.hero.title}</h1><p>{site.hero.subtitle}</p><button onClick={() => book()}>{site.hero.button}<ArrowRight size={17}/></button></div><div className="hero-bottom"><span>YU HE TANG · WELLNESS RITUALS</span><span className="hero-dots"><b/><i/><i/></span></div></section>
        <div className="quick-actions"><button onClick={() => go('services')}><Flame size={23} strokeWidth={1.3}/><strong>特色养护</strong><span>照顾身心</span></button><button onClick={() => go('stores')}><MapPin size={23} strokeWidth={1.3}/><strong>城市门店</strong><span>遇见一处静谧</span></button><button onClick={() => go('products')}><Leaf size={23} strokeWidth={1.3}/><strong>东方好物</strong><span>草本的温度</span></button></div>
        {site.sections.filter(section => section.enabled).map(section => <div key={section.id}>{homeSections[section.id]}</div>)}
        <div className="mini-footer"><Brand/><p>{site.tagline}</p><span>用心关照每一次到来</span></div>
      </>}

      {route.page === 'services' && <><div className="page-intro"><span className="eyebrow">A RITUAL, JUST FOR YOU</span><h1>照顾自己<br/>从此刻开始</h1><p>让细致的养护，成为生活的一部分。</p></div><div className="mini-filter">{['全部', ...new Set(services.map(item => item.category))].map(category => <button className={category === serviceCategory ? 'active' : ''} onClick={() => setServiceCategory(category)} key={category}>{category}</button>)}</div><div className="mini-section service-list">{services.filter(item => serviceCategory === '全部' || item.category === serviceCategory).map(serviceCard)}</div><div className="soft-message"><Leaf size={17}/>不必匆忙，找到适合自己的节奏。</div></>}

      {route.page === 'service' && activeService && <><div className="detail-hero"><img src={activeService.image} alt={activeService.name}/><span>{activeService.tag}</span></div><section className="mini-section detail-description"><span className="eyebrow">{activeService.english}</span><h1>{activeService.name}</h1><p className="detail-subtitle">{activeService.subtitle}</p><div className="detail-tags"><span><Clock3 size={14}/>{activeService.duration}</span><span>到店沟通 · 专属关照</span></div><p>{activeService.description}</p></section><section className="mini-section ritual-section"><h2>让每个细节，都被照顾</h2>{activeService.steps.map((step, index) => <div className="ritual-step" key={step}><span>0{index + 1}</span><div><h3>{step}</h3><p>{['从一声问候开始，慢慢进入舒适的节奏。', '倾听您的需要，确认舒适的服务体验。', '用专注的时间，细致关照每一处感受。', '把一份轻松，带回自己的日常。'][index]}</p></div></div>)}</section><div className="service-bottom"><button onClick={() => setContact(true)}><MessageCircle size={20}/><span>咨询</span></button><button className="primary mini-primary" onClick={() => book(activeService.id)}>预约这项养护<ArrowRight size={16}/></button></div></>}

      {route.page === 'stores' && <><div className="stores-banner"><img src="/media/store-08.webp" alt="裕和堂门店空间"/><div><span>FIND YOUR QUIET PLACE</span><h1>城市之中<br/>自有一处从容</h1></div></div><div className="mini-section store-heading"><div><h2>走进裕和堂</h2><p>以熟悉的温度，迎接每一次到来。</p></div><label className="district-select"><select aria-label="门店区域" value={district} onChange={event => setDistrict(event.target.value)}>{['全部区域', ...new Set(stores.map(item => item.district))].map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={13}/></label></div><div className="mini-section store-list">{stores.filter(item => district === '全部区域' || item.district === district).map(storeCard)}</div></>}

      {route.page === 'store' && activeStore && <><div className="store-detail-photo" onClick={() => setLightbox(activeStore.image)}><img src={activeStore.image} alt={activeStore.name}/><span><Plus size={12}/>查看大图</span></div><section className="mini-section detail-description"><span className="eyebrow">{activeStore.district} · {activeStore.tag}</span><h1>裕和堂 · {activeStore.name}</h1><p>{activeStore.description}</p><div className="store-information"><span><Clock3 size={15}/>{activeStore.hours}</span><span><MapPin size={15}/>{activeStore.address}</span></div><div className="store-action-row"><button onClick={() => !activeStore.latitude || !activeStore.longitude ? setContact(true) : window.open(`https://uri.amap.com/search?keyword=${encodeURIComponent(activeStore.address)}&city=上海`, '_blank', 'noopener,noreferrer')}><Navigation size={15}/>地图导航</button><button onClick={() => activeStore.phone ? window.location.assign(`tel:${activeStore.phone}`) : setContact(true)}><Phone size={15}/>联系门店</button></div></section><section className="mini-section"><h2>空间里的小确幸</h2><div className="store-gallery">{activeStore.gallery.map((url, index) => <button key={url + index} onClick={() => setLightbox(url)}><img src={url} alt={`空间图 ${index + 1}`} loading="lazy"/></button>)}</div></section><div className="service-bottom"><button onClick={() => setContact(true)}><MessageCircle size={20}/><span>咨询</span></button><button className="primary mini-primary" onClick={() => book(undefined, activeStore.id)}>预约这家门店<ArrowRight size={16}/></button></div></>}

      {route.page === 'spaces' && <><div className="page-intro"><span className="eyebrow">THE SPACE BETWEEN</span><h1>一店一境<br/>一寸一份用心</h1><p>窗光、木色、茶香。把忙碌留在门外。</p></div><div className="mini-filter">{site.galleryGroups.map((group, index) => <button key={group.id} className={galleryGroup === index ? 'active' : ''} onClick={() => setGalleryGroup(index)}>{group.name}</button>)}</div><div className="mini-section gallery-grid">{site.galleryGroups[galleryGroup]?.images.map((url, index) => <button key={url + index} onClick={() => setLightbox(url)}><img src={url} alt={`${site.galleryGroups[galleryGroup].name} ${index + 1}`} loading="lazy"/><span>YU HE TANG<Plus size={16}/></span></button>)}</div><div className="mini-section"><button className="outline-button full" onClick={() => go('stores')}>寻找属于您的那一处<ArrowRight size={16}/></button></div></>}

      {route.page === 'products' && <><div className="page-intro"><span className="eyebrow">NATURE, IN EVERYDAY LIFE</span><h1>草本有温度<br/>日常有好物</h1><p>从自然中来，把一份关照带回生活。</p></div><div className="mini-section product-grid">{products.map(item => <button className="product-card" key={item.id} onClick={() => go('product', item.id)}><div><img src={item.image} alt={item.name}/></div><span>{item.category}</span><h3>{item.name}</h3><p>{item.subtitle}</p></button>)}</div><div className="soft-message"><Leaf size={17}/>喜欢的好物，向门店老师了解更多。</div></>}

      {route.page === 'product' && activeProduct && <><div className="product-detail-image"><img src={activeProduct.image} alt={activeProduct.name}/></div><section className="mini-section detail-description"><span className="eyebrow">{activeProduct.category}</span><h1>{activeProduct.name}</h1><p className="detail-subtitle">{activeProduct.subtitle}</p><p>{activeProduct.description}</p><button className="primary mini-primary full" onClick={() => setContact(true)}>向门店了解<ArrowRight size={16}/></button></section><div className="mini-section product-origin"><img src="/media/herb-field.webp" alt="裕和堂艾草基地"/><div><span className="eyebrow">FROM THE ORIGIN</span><h2>好草本<br/>从一片艾田开始</h2><p>自然生长的馈赠，细致用心的日常。</p></div></div></>}

      {route.page === 'brand' && <><div className="brand-cover"><img src="/media/store-07.webp" alt="东方茶席"/><div><Brand/><h1>以艾为媒<br/>以和为本</h1></div></div><section className="mini-section brand-long-copy"><span className="eyebrow">THE WAY OF YU HE TANG</span><h2>好的关照<br/>藏在日常之间</h2><p>{site.brandStory}</p><img src="/media/ritual.webp" alt="裕和堂老师专注服务"/><h2>手有温度<br/>心有分寸</h2><p>从一盏茶、一句问候开始。认真倾听每一份需要，把关照落在细微之处，让每一次到来，都能自在安心。</p><button className="outline-button full" onClick={() => go('stores')}>走进裕和堂<ArrowRight size={16}/></button></section></>}

      {route.page === 'booking' && <BookingFlow site={site} {...bookingContext} onHome={()=>go('home')} onOrders={()=>go('orders')} onContact={()=>setContact(true)}/>}
      {route.page === 'orders' && <MyOrders onBook={()=>book()} onContact={()=>setContact(true)}/>}

      {!['home', 'booking', 'success'].includes(route.page) && <div className="subpage-end"><Leaf size={15}/><span>{site.tagline}</span></div>}
    </div>

    {rootPage && <nav className="mini-tabs">{[{ page: 'home', label: '首页', Icon: House }, { page: 'services', label: '养护', Icon: Leaf }, { page: 'stores', label: '门店', Icon: MapPin }, { page: 'booking', label: '预约', Icon: HeartHandshake }].map(({ page, label, Icon }) => <button key={page} className={route.page === page ? 'active' : ''} onClick={() => page === 'booking' ? book() : go(page)}><Icon size={22} strokeWidth={route.page === page ? 1.7 : 1.25}/><span>{label}</span>{route.page === page && <i/>}</button>)}</nav>}

    {lightbox && <div className="mini-overlay lightbox" onClick={() => setLightbox(null)}><button aria-label="关闭大图"><X size={24}/></button><img src={lightbox} alt="空间大图"/><span>轻触任意位置关闭</span></div>}
    {route.page==='booking'&&<button className='floating-orders' onClick={()=>go('orders')}>我的预约</button>}
    {contact && <div className="mini-overlay" onClick={() => setContact(false)}><div className="contact-sheet" onClick={event => event.stopPropagation()}><button className="sheet-close" aria-label="关闭客服" onClick={() => setContact(false)}><X size={19}/></button><MessageCircle size={33} strokeWidth={1.1}/><span className="eyebrow">WE ARE HERE FOR YOU</span><h2>每一份需要<br/>都值得被认真倾听</h2><p>{site.contact.message}</p>{site.contact.phone && <a className="outline-button full" href={`tel:${site.contact.phone}`}><Phone size={16}/>{site.contact.phone}</a>}{site.contact.wechat && <div className="wechat-id">门店微信：{site.contact.wechat}</div>}<button className="primary mini-primary full" onClick={() => { setContact(false); book() }}>提交预约申请<ArrowRight size={16}/></button><span className="small-note">微信小程序内支持原生客服会话；网页预览可使用电话咨询</span></div></div>}
    {privacy && <div className="mini-overlay" onClick={() => setPrivacy(false)}><div className="privacy-sheet" onClick={event => event.stopPropagation()}><button className="sheet-close" aria-label="关闭隐私说明" onClick={() => setPrivacy(false)}><X size={19}/></button><h2>预约隐私说明</h2><p>您的称呼、联系电话、意向门店、意向服务和预约时间，仅用于联系您并确认本次预约。您填写的备注也将提供给有权限的门店工作人员。</p><p>预约信息不会公开展示，不用于与本次预约无关的用途。如需更正或删除，请联系门店处理。</p><p>资料由裕和堂及本店授权工作人员用于预约接待，会员自述不作为已核实权益。</p><button className="primary mini-primary full" onClick={() => { setPrivacy(false);  }}>我已了解<CircleCheck size={16}/></button></div></div>}
  </div>
}
