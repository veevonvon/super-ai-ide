# 测试指南 (The Test Guide)

本指南旨在为开发人员提供在 `super-ai-ide` 项目中完成功能开发后进行测试的标准化流程。请在提交代码或发布版本前遵循以下步骤。

## 1. 静态代码检查与编译

在进行任何运行时测试之前，首先确保代码没有语法错误且符合项目的代码风格规范。

### 1.1 编译检查
运行 TypeScript 编译器以捕获类型错误和语法错误。

```bash
npm run compile
```

*   **预期结果**: 命令执行成功，无任何错误输出。如果出现错误，请根据提示修复代码。

### 1.2 Lint 检查
使用 ESLint 检查代码风格和潜在问题。

```bash
npm run lint
```

*   **预期结果**: 命令执行成功，无报错或警告。

---

## 2. 常见问题排查

*   **Webview 空白**: 检查 `out/webview` 目录下是否有构建好的 HTML/JS 资源。确保 CSP (Content Security Policy) 设置正确。
*   **命令未找到**: 检查 `package.json` 中的 `activationEvents` 和 `contributes.commands` 是否配置正确。
*   **Lint 报错**: 运行 `npm run lint -- --fix` 可以自动修复部分格式问题。
