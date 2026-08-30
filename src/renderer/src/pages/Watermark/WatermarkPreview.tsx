import { useEffect, useRef } from 'react'
import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import { drawWatermarkOn } from '@renderer/utils/watermarkRenderer'
import styles from './WatermarkPreview.module.css'

export function WatermarkPreview(): JSX.Element {
  const config = useWatermarkStore((s) => s.config)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#f5f5f5'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    drawWatermarkOn(ctx, canvas.width, canvas.height, config)
  }, [config])

  return (
    <div className={styles.preview}>
      <h3 className={styles.title}>水印效果预览</h3>
      <canvas ref={canvasRef} width={360} height={200} className={styles.canvas} />
    </div>
  )
}
