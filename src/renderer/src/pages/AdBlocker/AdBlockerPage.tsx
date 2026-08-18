import { useEffect } from 'react'
import { useAdblockStore } from '@renderer/stores/adblockStore'
import { ApplyBar } from './ApplyBar'
import { RuleGroupList } from './RuleGroupList'
import styles from './AdBlockerPage.module.css'

export function AdBlockerPage(): JSX.Element {
  const load = useAdblockStore((s) => s.load)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>广告屏蔽</h1>
      <ApplyBar />
      <RuleGroupList />
    </div>
  )
}
