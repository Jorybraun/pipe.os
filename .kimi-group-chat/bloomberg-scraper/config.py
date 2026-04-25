"""
Configuration file for Bloomberg Scraper and Telegram Bot.
"""

# Telegram Bot Configuration
TELEGRAM_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN_HERE"

# Bloomberg Terminal Configuration
BLOOMBERG_BASE_URL = "https://www.bloomberg.com/markets/stocks"
BLOOMBERG_USERNAME = "YOUR_BLOOMBERG_USERNAME"
BLOOMBERG_PASSWORD = "YOUR_BLOOMBERG_PASSWORD"

# Scraper Configuration
REQUEST_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_DELAY = 5

# Output Configuration
OUTPUT_DIRECTORY = "./output"
CSV_ENCODING = "utf-8"

# Logging Configuration
LOG_LEVEL = "INFO"
LOG_FILE = "./logs/bloomberg_scraper.log"