# 前端开发规则

## 组件规范
- 必须使用函数组件 + Hooks
- Props 必须定义 TypeScript 接口
- 样式使用 CSS Modules（`*.module.css`）
- 导出命名导出而非默认导出

## 状态管理
- 全局状态使用项目指定的方案（Zustand / Redux Toolkit）
- 局部状态优先使用 `useState` / `useReducer`

## 文件命名
- 组件文件：`PascalCase.tsx`
- 样式文件：`ComponentName.module.css`
- 工具函数：`camelCase.ts`

## 性能要求
- 列表渲染必须使用 `key`
- 避免在渲染函数中创建新对象/函数
- 合理使用 `React.memo` 和 `useMemo`