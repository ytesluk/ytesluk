## Eduardo Tesluk

Desenvolvedor full stack. Gosto de software que precisa funcionar no mundo
real, com gente usando, dados que não podem se perder e alguém que vai
manter aquilo depois que eu sair.

Curitiba, PR · [LinkedIn](https://www.linkedin.com/in/eduardo-tesluk-252110251) · [e-mail](mailto:eduardotesluk10@gmail.com)

![Python](https://img.shields.io/badge/-Python-3776AB?style=flat-square&logo=python&logoColor=white)
![JavaScript](https://img.shields.io/badge/-JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/-React-61DAFB?style=flat-square&logo=react&logoColor=black)
![Next.js](https://img.shields.io/badge/-Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![Node.js](https://img.shields.io/badge/-Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![SQL](https://img.shields.io/badge/-SQL-4479A1?style=flat-square&logo=postgresql&logoColor=white)
![SQLite](https://img.shields.io/badge/-SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
---

### Sistema de Controle Almox

**[ytesluk/sistema-de-controle-almox](https://github.com/ytesluk/sistema-de-controle-almox)** · Next.js · TypeScript · SQLite

A seção de almoxarifado do meu quartel controlava documentos — guias de
transferência, notas fiscais, notas de suprimento, descargas de material — em
arquivos espalhados por vários computadores. Cada máquina tinha a sua versão
da verdade, e ninguém sabia ao certo o que já tinha sido lançado.

Construí um sistema para resolver isso. Um computador da seção serve, os
outros acessam pelo navegador, e todo mundo vê o mesmo cadastro. Cada militar
tem seu login, a foto do documento fica anexada ao registro, e o histórico
mostra quem fez o quê.

**O que tem dentro**

- Autenticação própria com `scrypt`, três perfis de acesso e registro de auditoria
- Upload de fotos e PDFs servidos por rota autenticada — nunca de pasta pública
- Banco SQLite em arquivo único: funciona **sem internet**, na rede interna
- Migrações automáticas, para atualizar o sistema sem perder dado nenhum
- Interface responsiva, tema claro e escuro

**O que eu considero a parte mais importante**

Não parei no código. O repositório inclui instalador para Windows, script de
backup que usa a API do SQLite (cópia íntegra mesmo com o sistema em uso),
recuperação de senha de administrador, manual da seção e roteiro de
instalação.

Software que ninguém consegue instalar, atualizar ou restaurar não resolve
problema de ninguém — resolve só enquanto quem escreveu está por perto.

---

### Tecnologias

`TypeScript` · `React` · `Next.js` · `Node.js` · `SQLite` · `PHP` · `Tailwind CSS` · `Git`

---

📫 **eduardotesluk10@gmail.com**
