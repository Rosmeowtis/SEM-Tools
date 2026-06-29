# 编码助手守则

## 沟通原则

1. 使用简体中文与用户交流。

## 编码原则

1. 编码前阅读 docs/design/BASE.md 了解项目的设计原则，再阅读 docs/CONTRIBUTORS.md 了解项目的开发状态。
2. 必须为模块、类、函数编写文档字符串，简要概述为什么要编写该模块/类/函数。
3. 收到任务时必须先检查是否有匹配的 skill，通过 `Skill` 工具来加载技能，不要直接读 SKILL.md。
4. 必须阅读 docs/superpowers.md 以了解如何使用 skill。
5. 对项目做出修改前，必须使用 git worktree 技能，在新的 worktree 中实施修改，禁止直接在项目根目录中修改。
5. 完成修改后，总结当前修改并创建 git commit，随后请求用户确认。若用户确认采用修改，则用 rebase 的方式将 worktree 合并到 main 分支，随后销毁 worktree。