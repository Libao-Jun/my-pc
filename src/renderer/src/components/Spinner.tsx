import styles from './Spinner.module.css'

interface SpinnerProps {
  size?: number
}

export function Spinner({ size = 16 }: SpinnerProps): JSX.Element {
  return <span className={styles.spinner} style={{ width: size, height: size }} />
}
