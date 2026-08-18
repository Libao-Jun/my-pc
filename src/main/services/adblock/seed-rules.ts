import type { AdblockCategory } from '@shared/types'

export interface SeedGroup {
  software: string
  domains: Array<{ domain: string; category: AdblockCategory }>
}

// 起步种子清单（用户可在 UI 增删改，hosts 不支持通配符，全为字面子域）。
// 提示：域名准确性需按实际软件排查维护，避免屏蔽整站主域。
export const SEED_GROUPS: SeedGroup[] = [
  {
    software: '通用广告网络',
    domains: [
      { domain: 'pagead2.googlesyndication.com', category: 'ad' },
      { domain: 'adservice.google.com', category: 'ad' },
      { domain: 'googleads.g.doubleclick.net', category: 'ad' },
      { domain: 'static.doubleclick.net', category: 'ad' },
      { domain: 'adsrvr.org', category: 'ad' },
      { domain: 'ib.adnxs.com', category: 'ad' }
    ]
  },
  {
    software: '搜狗输入法',
    domains: [
      { domain: 'tuijian.sogou.com', category: 'recommend' },
      { domain: 'mt.sogoucdn.com', category: 'recommend' },
      { domain: 'ad.sogou.com', category: 'ad' }
    ]
  },
  {
    software: '百度输入法',
    domains: [
      { domain: 'cpro.baidu.com', category: 'ad' },
      { domain: 'pos.baidu.com', category: 'ad' },
      { domain: 'nsclick.baidu.com', category: 'ad' }
    ]
  },
  {
    software: '视频播放器',
    domains: [
      { domain: 'ad.qq.com', category: 'ad' },
      { domain: 'vd.l.qq.com', category: 'ad' }
    ]
  }
]
