# Mermaid 语法速查

> 本速查只收录受限子集（`shared/mermaid.ts` 解析器支持的全部语法）；超出子集的 Mermaid 特性一律不用。

## 思维导图（mindmap）

```
mindmap
  root((主题))
    分支A
      子A1
      子A2
    分支B
      子B1
```

## 流程图（flowchart）

```
flowchart TD
  A[开始] --> B{是否通过?}
  B -- 是 --> C[通过处理]
  B -- 否 --> D[驳回处理]
  C --> E[结束]
  D --> E
```

## 审批流程（flowchart + 角色）

```
flowchart LR
  S[提交人 提交] --> M{经理 审批}
  M -- 同意 --> H[HR 复核]
  M -- 驳回 --> S
  H --> E[结束]
```

- 用 `节点名[显示文本]` 标注角色 + 动作；`{...}` 表示判断节点。
- 审批流的「会签 / 或签」用并行分叉 + 汇合节点表达。
