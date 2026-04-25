"""
Telegram Bot Integration Module
Integrates the Bloomberg scraper with a Telegram bot for automated data retrieval.
"""

import logging
from telegram import Update, Bot
from telegram.ext import Application, CommandHandler, ContextTypes
from bloomberg_scraper import BloombergScraper, BloombergDataProcessor
import pandas as pd
from datetime import datetime
import os

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

class BloombergTelegramBot:
    """
    Telegram bot for Bloomberg data retrieval and CSV export.
    
    Commands:
    /start - Initialize the bot
    /scrape - Scrape latest data and export to CSV
    /status - Check bot status and last update
    /help - Show available commands
    """
    
    def __init__(self, telegram_token: str):
        """
        Initialize the bot.
        
        Args:
            telegram_token: Telegram bot API token
        """
        self.token = telegram_token
        self.scraper = BloombergScraper()
        self.last_update = None
        self.application = Application.builder().token(self.token).build()
        
        # Add handlers
        self.application.add_handler(CommandHandler("start", self.start))
        self.application.add_handler(CommandHandler("scrape", self.scrape_data))
        self.application.add_handler(CommandHandler("status", self.status))
        self.application.add_handler(CommandHandler("help", self.help_command))
        
    async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /start command."""
        welcome_message = (
            "Welcome to Bloomberg Data Bot!\n\n"
            "Available commands:\n"
            "/scrape - Fetch latest market data and export to CSV\n"
            "/status - Check last update time\n"
            "/help - Show this help message"
        )
        await update.message.reply_text(welcome_message)
        
    async def scrape_data(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """
        Handle /scrape command.
        Scrapes data and sends CSV file to user.
        """
        await update.message.reply_text("Fetching data from Bloomberg...")
        
        try:
            # Scrape data
            html_content = self.scraper.fetch_data("/markets/stocks")
            
            if html_content:
                # Parse to DataFrame
                df = self.scraper.parse_stock_data(html_content)
                
                if not df.empty:
                    # Export to CSV
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    filename = f"bloomberg_data_{timestamp}.csv"
                    filepath = self.scraper.to_csv(df, filename)
                    
                    if filepath and os.path.exists(filepath):
                        # Send file to user
                        await update.message.reply_document(
                            document=open(filepath, 'rb'),
                            caption=f"Bloomberg market data - {timestamp}"
                        )
                        
                        self.last_update = datetime.now()
                        logger.info(f"Data exported and sent: {filepath}")
                    else:
                        await update.message.reply_text("Error: Could not create CSV file")
                else:
                    await update.message.reply_text("Error: No data found in the response")
            else:
                await update.message.reply_text("Error: Could not fetch data from Bloomberg")
                
        except Exception as e:
            logger.error(f"Error in scrape_data: {str(e)}")
            await update.message.reply_text(f"An error occurred: {str(e)}")
    
    async def status(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /status command."""
        if self.last_update:
            status_message = f"Last data update: {self.last_update.strftime('%Y-%m-%d %H:%M:%S')}"
        else:
            status_message = "No data has been fetched yet. Use /scrape to get data."
        
        await update.message.reply_text(status_message)
    
    async def help_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /help command."""
        help_message = (
            "Bloomberg Data Bot - Help\n\n"
            "Commands:\n"
            "/start - Start the bot\n"
            "/scrape - Fetch latest data and export to CSV\n"
            "/status - Check bot status\n"
            "/help - Show this message\n\n"
            "The bot fetches market data from Bloomberg and exports it to CSV format."
        )
        await update.message.reply_text(help_message)
    
    def run(self):
        """Start the bot."""
        logger.info("Starting Bloomberg Telegram Bot...")
        self.application.run_polling()

# Example usage
if __name__ == "__main__":
    import config
    
    # Initialize and run bot
    bot = BloombergTelegramBot(config.TELEGRAM_TOKEN)
    bot.run()