import telebot

# Aqui fica o Token que o BotFather te deu
CHAVE_API = "8785402593:AAFR9WOn9CZZCPIk1gV2liLuwwZovn4cHzY"

# Criando a conexão com o seu bot
bot = telebot.TeleBot(CHAVE_API)

# Configurando o bot para responder ao comando /start
@bot.message_handler(commands=['start'])
def boas_vindas(mensagem):
    bot.reply_to(mensagem, "Olá! Eu sou o elzobrito_bot. Que bom ter você por aqui!")

# Configurando o bot para responder a qualquer outro texto
@bot.message_handler(func=lambda mensagem: True)
def responder_qualquer_coisa(mensagem):
    bot.reply_to(mensagem, "Recebi sua mensagem: '" + mensagem.text + "', mas ainda estou aprendendo a conversar!")

# Isso faz o bot ficar rodando e "ouvindo" o Telegram sem parar
print("O bot está rodando...")
bot.polling()