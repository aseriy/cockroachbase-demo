# First run: pip install yfinance
import random
import yfinance as yf

def ticker_quote():
    # Pick a random ticker from a predefined list
    tickers = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "ORCL", "BA", "F"]
    random_ticker = random.choice(tickers)

    # Fetch the stock data
    stock = yf.Ticker(random_ticker)
    price = stock.history(period="1d")["Close"].iloc[-1]

    return f"{random_ticker} is currently trading at ${price:.2f}"
