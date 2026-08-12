# 后端开发规则

## 架构要求
- 严格遵循 控制器 → 服务 → 数据访问层 三层架构
- API 路由统一在 `routes/` 目录下定义
- 业务逻辑必须封装在 `services/` 中

## 代码规范
- 使用 TypeScript 严格模式，禁止 `any` 类型
- 所有接口必须使用 Joi / Zod 进行参数校验
- 错误处理统一使用 `AppError` 类
- 数据库操作必须通过 ORM 查询构建器

## 文件命名
- 路由文件：`*.routes.ts`
- 控制器：`*.controller.ts`
- 服务：`*.service.ts`
- 中间件：`*.middleware.ts`