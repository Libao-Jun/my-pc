import { useEffect, useRef, useState } from 'react'
import styles from './SearchInput.module.css'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  delay?: number
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  delay = 300
}: SearchInputProps): JSX.Element {
  const [text, setText] = useState(value)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    setText(value)
  }, [value])

  useEffect(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (text !== value) onChange(text)
    }, delay)
    return () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
    }
  }, [text, delay, onChange, value])

  return (
    <input
      className={styles.input}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
    />
  )
}
