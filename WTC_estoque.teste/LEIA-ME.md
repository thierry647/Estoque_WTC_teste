# Estoque WTC

Sistema local para organizar itens em pastas, acompanhar entradas, transferências e gerar um código individual para cada unidade. A interface usa JavaScript e salva os dados no IndexedDB do navegador.

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
4. Clique em **Códigos e estado** para consultar os códigos de cada unidade ou imprimir etiquetas. Para 7 facas com prefixo `Fc`, a sequência será `Fc0001` a `Fc0007`.
5. Use **Entrada / Saída** para registrar reposições e transferir itens. Uma entrada cria novos códigos na pasta atual. Uma saída transfere todas as unidades do item para outra pasta existente, preservando seus códigos e registrando a saída e a entrada no histórico. Se ainda não houver pasta de destino, crie uma para continuar.
6. Em **Códigos e estado**, cada código tem um estado individual. Adicione estados personalizados para a pasta, como `Quebrado` ou `Enferrujado`, e escolha o estado de cada unidade. A lista é independente por pasta.
7. Marque os itens e use **Mover para uma pasta** para transferir vários cadastros. Os códigos e estados acompanham os itens, e cada transferência fica registrada no histórico.
8. Use **Importar** para restaurar um arquivo JSON exportado anteriormente. A importação substitui o estoque atual e pede confirmação.
9. Exclua uma pasta pelo ícone de lixeira. A pasta e seus itens ficam recuperáveis por 30 dias; a lixeira permite restaurar ou apagar definitivamente.
10. Use **Exportar em planilhas** para escolher uma pasta e exportar todos os seus itens como Planilha Google, Excel (`.xlsx`) ou CSV. A exportação pede confirmação da pasta completa. A opção Planilha Google abre uma planilha nova e prepara os dados copiados para colar na célula A1. **Cópia JSON** salva uma cópia completa para backup ou restauração, incluindo o histórico.

Os dados são salvos automaticamente no IndexedDB deste navegador e dispositivo. Para transferi-los entre computadores ou manter uma cópia de segurança, use **Cópia JSON** e depois **Importar** no outro navegador. Apagar os dados do navegador pode apagar o estoque salvo.

O sistema migra automaticamente os dados antigos de `localStorage` quando os encontra na mesma origem. `file://` e `http://localhost:8000` podem usar armazenamentos separados; se houver dados na versão antiga, exporte uma cópia antes de mudar o jeito de abrir e importe-a depois.

## Capacidade e velocidade

O banco é separado em registros de itens, pastas e movimentações no IndexedDB. A lista mostra 100 cadastros por página, o histórico mostra 100 movimentações por página e os códigos são exibidos em grupos de 200. Isso evita criar milhares de elementos na tela ao mesmo tempo.

## Sobre uma API para o trabalho

Para uma pessoa usando um computador, a versão local pode ser suficiente. Uma API passa a ser útil quando várias pessoas ou computadores precisam trabalhar com o mesmo estoque. Nesse caso, é mais simples escolher um backend só (Python ou C#) com um banco central, em vez de misturar os dois. A interface JavaScript pode continuar igual.

## Abrir no VS Code

Abra o VS Code, escolha **Arquivo → Abrir Pasta…** e selecione esta pasta. O sistema é um site estático em `index.html`; para usar, abra esse arquivo no navegador.

