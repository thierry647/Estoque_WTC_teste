# Estoque WTC

Sistema local para organizar itens em pastas, acompanhar entradas e saídas e gerar um código individual para cada unidade.

## Como abrir

Abra o arquivo `index.html` em um navegador atualizado (Chrome, Edge ou Firefox). Não é necessário instalar nada nem ter internet para usar.

## Como usar

1. Clique em **Criar pasta** para separar os itens, por exemplo: Ferramentas, Cozinha ou Eletrônicos.
2. Clique em **Adicionar item**, informe o nome, a quantidade e a pasta. Esse cadastro inicial também aparece como uma entrada no histórico.
3. O sistema sugere um prefixo com base nas consoantes do nome. Para “Faca”, sugere `Fc`. Você pode editar o prefixo antes de salvar.
4. Clique em **Ver códigos** para consultar os códigos gerados para cada unidade ou imprimir etiquetas. Para 7 facas com prefixo `Fc`, a sequência será `Fc0001` a `Fc0007`.
5. Use **Entrada / Saída** para registrar reposições e retiradas. O sistema guarda o histórico, impede saídas maiores que o saldo e não reutiliza códigos de unidades que já saíram.
6. Use **Importar** para restaurar um arquivo JSON exportado anteriormente. A importação substitui o estoque atual e pede confirmação.
7. Use a busca e os filtros para localizar itens. **Exportar** baixa uma cópia dos dados em JSON, incluindo o histórico.

Os dados são salvos automaticamente no armazenamento deste navegador e deste dispositivo. Para transferi-los entre computadores ou manter uma cópia de segurança, use **Exportar** e depois **Importar** no outro navegador. Apagar os dados do navegador pode apagar o estoque salvo.

## Abrir no VS Code

Abra o VS Code, escolha **Arquivo → Abrir Pasta…** e selecione esta pasta. O sistema é um site estático em `index.html`; para usar, abra esse arquivo no navegador.

## Publicar no GitHub

O repositório local precisa de um repositório remoto no GitHub para receber `git push`. No VS Code, entre na sua conta GitHub, abra **Controle do Código-Fonte** e use **Publicar no GitHub**. Escolha privado ou público conforme desejar. Depois, o botão de sincronização envia os commits para esse repositório.
