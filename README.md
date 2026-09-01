## Eduardo Tesluk

Desenvolvedor full stack, em Curitiba. Gosto de software que precisa funcionar
no mundo real — com gente usando, dados que não podem se perder e alguém que
vai manter aquilo depois que eu sair.

---

### 🗂️ Controle Almox 11 CT

**[sistema-de-controle-almox](https://github.com/ytesluk/sistema-de-controle-almox)** · Next.js · TypeScript · SQLite

Sistema de controle documental para a seção de almoxarifado de uma unidade do
Exército Brasileiro, **em uso pela seção**.

**O problema.** A seção controla guias de transferência, notas fiscais, guias de
fornecimento e descargas de material — cada uma com número, data, unidade de
origem e destino. O controle era feito em arquivos espalhados por vários
computadores, e cada máquina tinha a sua versão da verdade. Documento lançado
duas vezes, documento que ninguém sabia se já tinha sido conferido, e procurar
um número virava uma volta pela seção perguntando quem tinha visto o quê.

**A solução.** Um computador serve, os outros acessam pelo navegador na rede
interna. Todo mundo vê o mesmo cadastro, no mesmo instante. Cada militar tem
seu login, a foto do documento fica anexada ao registro, e o histórico mostra
quem fez o quê.

**Decisões que valem comentar**

- **Funciona sem internet.** A rede do quartel é interna, então escrevi a
  autenticação do zero em vez de usar serviço externo. Senhas com `scrypt` e sal.
- **SQLite em arquivo único.** Não exige instalar servidor de banco no quartel,
  e o backup vira copiar uma pasta.
- **Fotos fora de pasta pública.** São entregues por uma rota que confere a
  sessão antes — link copiado não abre para quem não está autenticado.
- **Migrações automáticas.** Atualizar o sistema não pode significar perder
  documento cadastrado.
- **Responsivo de verdade.** Tabela no computador, cartões no celular — porque é
  do celular que sai a foto do documento.

**O que eu considero a parte mais importante**

Não parei no código. O repositório inclui instalador para Windows, script de
backup que usa a função do próprio SQLite (cópia íntegra mesmo com o sistema em
uso), recuperação de senha de administrador, manual da seção e roteiro de
instalação.

Software que ninguém consegue instalar, atualizar ou restaurar resolve o
problema só enquanto quem escreveu está por perto.

---

###  MegaRaspa

**[megaraspa](https://github.com/ytesluk/megaraspa)** · PHP · MySQL

Plataforma de raspadinhas online desenvolvida para um cliente do setor de
marketing digital. Contas de usuário com saldo, catálogo de raspadinhas com
tabela de prêmios configurável, painel administrativo e programa de indicação
multinível com comissionamento por **CPA e revshare** — o modelo usado no
mercado de marketing de performance.

Escrito em PHP puro com PDO. O repositório traz um recorte do projeto e a
estrutura completa do banco; a integração de pagamento ficou de fora.

---

### Tecnologias

`TypeScript` · `React` · `Next.js` · `Node.js` · `SQLite` · `PHP` · `MySQL` · `Tailwind CSS` · `Git`

---

📫 **eduardotesluk10@gmail.com** · 📍 Curitiba - PR
