# Estoque WTC

Sistema local para organizar itens em pastas, acompanhar entradas e saídas e gerar um código individual para cada unidade. A interface usa JavaScript e salva os dados no IndexedDB do navegador.

## Como abrir

Para manter o mesmo armazenamento e evitar diferenças entre navegadores ao abrir arquivos locais, rode o servidor local incluído no Python:

1. Abra um terminal nesta pasta.
2. Execute `py -m http.server 8000` (ou `python -m http.server 8000`).
3. Abra `http://localhost:8000` no navegador.

O servidor fica apenas no seu computador. Não é necessário instalar pacotes nem ter internet.

## Como usar

1. Clique em **Criar pasta** para separar os itens, por exemplo: Ferramentas, Cozinha ou Eletrônicos.
2. Clique em **Adicionar item**, informe o nome, a quantidade e a pasta. Esse cadastro inicial também aparece como uma entrada no histórico.
3. O sistema sugere um prefixo com base nas consoantes do nome. Para “Faca”, sugere `Fc`. Você pode editar o prefixo antes de salvar.
4. Clique em **Códigos e estado** para consultar os códigos gerados para cada unidade ou imprimir etiquetas. Para 7 facas com prefixo `Fc`, a sequência será `Fc0001` a `Fc0007`.
5. Use **Entrada / Saída** para registrar reposições e retiradas. Ao selecionar uma pasta, o resumo mostra unidades atuais, entradas e saídas acumuladas. O sistema impede saídas maiores que o saldo e não reutiliza códigos de unidades que já saíram.
6. Em **Códigos e estado**, cada código tem um estado individual. Adicione estados personalizados para a pasta, como `Quebrado` ou `Enferrujado`, e escolha o estado de cada unidade. A lista é independente por pasta; excluir um estado retorna as unidades marcadas para `Bom`.
7. Marque os itens e use **Mover para uma pasta** para mudar vários cadastros de pasta de uma vez.
8. Use **Importar** para restaurar um arquivo JSON exportado anteriormente. A importação substitui o estoque atual e pede confirmação.
9. Exclua uma pasta pelo ícone de lixeira. A pasta e seus itens ficam recuperáveis por 30 dias; a lixeira permite restaurar ou apagar definitivamente.
10. Use a busca e os filtros para localizar itens. **Planilha CSV** baixa uma linha por unidade, com código, objeto, estado e pasta. O arquivo abre no Excel; no Google Sheets, escolha **Arquivo → Importar → Fazer upload** e selecione o CSV. **Cópia JSON** também salva o histórico para backup ou restauração.

Os dados são salvos automaticamente no IndexedDB deste navegador e dispositivo. Para transferi-los entre computadores ou manter uma cópia de segurança, use **Exportar** e depois **Importar** no outro navegador. Apagar os dados do navegador pode apagar o estoque salvo.

O sistema migra automaticamente os dados antigos de `localStorage` quando os encontra na mesma origem. `file://` e `http://localhost:8000` podem usar armazenamentos separados; se houver dados na versão antiga, exporte uma cópia antes de mudar o jeito de abrir e importe-a depois.

## Capacidade e velocidade

O banco é separado em registros de itens, pastas e movimentações no IndexedDB. A lista mostra 100 cadastros por página, o histórico mostra 100 movimentações por página e os códigos são exibidos em grupos de 200. Isso evita criar milhares de elementos na tela ao mesmo tempo.

## Sobre uma API para o trabalho

Para uma pessoa usando um computador, a versão local pode ser suficiente. Uma API passa a ser útil quando várias pessoas ou computadores precisam trabalhar com o mesmo estoque. Nesse caso, é mais simples escolher um backend só (Python ou C#) com um banco central, em vez de misturar os dois. A interface JavaScript pode continuar igual.

## Abrir no VS Code

Abra o VS Code, escolha **Arquivo → Abrir Pasta…** e selecione esta pasta. O sistema é um site estático em `index.html`; para usar, abra esse arquivo no navegador.

## Publicar no GitHub

O repositório local precisa de um repositório remoto no GitHub para receber `git push`. No VS Code, entre na sua conta GitHub, abra **Controle do Código-Fonte** e use **Publicar no GitHub**. Escolha privado ou público conforme desejar. Depois, o botão de sincronização envia os commits para esse repositório.
