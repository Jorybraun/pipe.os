"""
Bloomberg HTML Terminal Scraper Module
A Python module for scraping data from Bloomberg HTML terminal and parsing it into pandas DataFrames.
"""

import requests
from bs4 import BeautifulSoup
import pandas as pd
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
import json

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class BloombergScraper:
    """
    A scraper for Bloomberg HTML terminal data.
    
    This class handles authentication, data extraction, and conversion
    to pandas DataFrames for analysis.
    """
    
    def __init__(self, base_url: str = "https://www.bloomberg.com/markets/stocks"):
        """
        Initialize the Bloomberg scraper.
        
        Args:
            base_url: The base URL for the Bloomberg HTML terminal
        """
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
        })
        self.authenticated = False
        
    def authenticate(self, username: str, password: str) -> bool:
        """
        Authenticate with the Bloomberg terminal.
        
        Args:
            username: Bloomberg terminal username
            password: Bloomberg terminal password
            
        Returns:
            bool: True if authentication successful, False otherwise
        """
        try:
            # Note: Actual authentication mechanism will depend on Bloomberg's system
            login_data = {
                'username': username,
                'password': password
            }
            response = self.session.post(
                f"{self.base_url}/login",
                data=login_data,
                timeout=30
            )
            
            if response.status_code == 200:
                self.authenticated = True
                logger.info("Successfully authenticated with Bloomberg terminal")
                return True
            else:
                logger.error(f"Authentication failed with status code: {response.status_code}")
                return False
                
        except Exception as e:
            logger.error(f"Authentication error: {str(e)}")
            return False
    
    def fetch_data(self, endpoint: str = "/markets/stocks", params: Optional[Dict] = None) -> Optional[str]:
        """
        Fetch data from Bloomberg terminal.
        
        Args:
            endpoint: API endpoint to fetch data from
            params: Optional query parameters
            
        Returns:
            str: HTML content if successful, None otherwise
        """
        try:
            url = f"{self.base_url}{endpoint}"
            response = self.session.get(url, params=params, timeout=30)
            
            if response.status_code == 200:
                logger.info(f"Successfully fetched data from {endpoint}")
                return response.text
            else:
                logger.error(f"Failed to fetch data. Status code: {response.status_code}")
                return None
                
        except requests.RequestException as e:
            logger.error(f"Request error: {str(e)}")
            return None
    
    def parse_stock_data(self, html_content: str) -> pd.DataFrame:
        """
        Parse stock data from HTML content into a pandas DataFrame.
        
        Args:
            html_content: HTML content from Bloomberg terminal
            
        Returns:
            pd.DataFrame: DataFrame containing stock data
        """
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Find data tables (adjust selectors based on actual Bloomberg HTML structure)
            tables = soup.find_all('table', {'class': 'data-table'})
            
            if not tables:
                logger.warning("No data tables found in HTML content")
                return pd.DataFrame()
            
            # Parse first data table
            df = pd.read_html(str(tables[0]))[0]
            
            # Clean and format data
            df = self._clean_dataframe(df)
            
            logger.info(f"Successfully parsed {len(df)} rows of stock data")
            return df
            
        except Exception as e:
            logger.error(f"Error parsing stock data: {str(e)}")
            return pd.DataFrame()
    
    def parse_market_data(self, html_content: str) -> Dict[str, pd.DataFrame]:
        """
        Parse various market data from HTML content.
        
        Args:
            html_content: HTML content from Bloomberg terminal
            
        Returns:
            Dict[str, pd.DataFrame]: Dictionary of DataFrames for different data types
        """
        data_frames = {}
        
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Parse different sections
            sections = {
                'indices': self._parse_indices(soup),
                'stocks': self._parse_stocks(soup),
                'currencies': self._parse_currencies(soup),
                'commodities': self._parse_commodities(soup)
            }
            
            for section_name, data in sections.items():
                if data is not None and not data.empty:
                    data_frames[section_name] = data
                    
            logger.info(f"Successfully parsed {len(data_frames)} data sections")
            return data_frames
            
        except Exception as e:
            logger.error(f"Error parsing market data: {str(e)}")
            return data_frames
    
    def _parse_indices(self, soup: BeautifulSoup) -> pd.DataFrame:
        """Parse market indices data."""
        try:
            indices_section = soup.find('div', {'id': 'indices'})
            if indices_section:
                table = indices_section.find('table')
                if table:
                    return pd.read_html(str(table))[0]
            return pd.DataFrame()
        except Exception:
            return pd.DataFrame()
    
    def _parse_stocks(self, soup: BeautifulSoup) -> pd.DataFrame:
        """Parse stock data."""
        try:
            stocks_section = soup.find('div', {'id': 'stocks'})
            if stocks_section:
                table = stocks_section.find('table')
                if table:
                    return pd.read_html(str(table))[0]
            return pd.DataFrame()
        except Exception:
            return pd.DataFrame()
    
    def _parse_currencies(self, soup: BeautifulSoup) -> pd.DataFrame:
        """Parse currency data."""
        try:
            currencies_section = soup.find('div', {'id': 'currencies'})
            if currencies_section:
                table = currencies_section.find('table')
                if table:
                    return pd.read_html(str(table))[0]
            return pd.DataFrame()
        except Exception:
            return pd.DataFrame()
    
    def _parse_commodities(self, soup: BeautifulSoup) -> pd.DataFrame:
        """Parse commodities data."""
        try:
            commodities_section = soup.find('div', {'id': 'commodities'})
            if commodities_section:
                table = commodities_section.find('table')
                if table:
                    return pd.read_html(str(table))[0]
            return pd.DataFrame()
        except Exception:
            return pd.DataFrame()
    
    def _clean_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Clean and format DataFrame.
        
        Args:
            df: Raw DataFrame
            
        Returns:
            pd.DataFrame: Cleaned DataFrame
        """
        # Remove any completely empty rows or columns
        df = df.dropna(how='all').dropna(axis=1, how='all')
        
        # Reset index
        df = df.reset_index(drop=True)
        
        # Add timestamp
        df['scraped_at'] = datetime.now()
        
        return df
    
    def to_csv(self, df: pd.DataFrame, filename: str = "bloomberg_data.csv", 
               output_dir: str = "./output") -> str:
        """
        Export DataFrame to CSV file.
        
        Args:
            df: DataFrame to export
            filename: Name of the output file
            output_dir: Directory for output files
            
        Returns:
            str: Path to the exported file
        """
        try:
            import os
            os.makedirs(output_dir, exist_ok=True)
            
            filepath = os.path.join(output_dir, filename)
            df.to_csv(filepath, index=False)
            
            logger.info(f"Data exported to {filepath}")
            return filepath
            
        except Exception as e:
            logger.error(f"Error exporting to CSV: {str(e)}")
            return ""
    
    def scrape_and_export(self, endpoint: str = "/markets/stocks",
                         filename: str = "bloomberg_data.csv") -> str:
        """
        Convenience method to scrape data and export to CSV in one step.
        
        Args:
            endpoint: API endpoint to scrape
            filename: Output filename
            
        Returns:
            str: Path to the exported CSV file
        """
        html_content = self.fetch_data(endpoint)
        
        if html_content:
            df = self.parse_stock_data(html_content)
            if not df.empty:
                return self.to_csv(df, filename)
        
        logger.error("Failed to scrape and export data")
        return ""

class BloombergDataProcessor:
    """
    Additional data processing utilities for Bloomberg data.
    """
    
    @staticmethod
    def merge_dataframes(dataframes: List[pd.DataFrame], 
                        on: Optional[str] = None) -> pd.DataFrame:
        """
        Merge multiple DataFrames.
        
        Args:
            dataframes: List of DataFrames to merge
            on: Column to merge on
            
        Returns:
            pd.DataFrame: Merged DataFrame
        """
        if not dataframes:
            return pd.DataFrame()
        
        result = dataframes[0]
        for df in dataframes[1:]:
            if on:
                result = pd.merge(result, df, on=on, how='outer')
            else:
                result = pd.concat([result, df], ignore_index=True)
        
        return result
    
    @staticmethod
    def filter_by_date(df: pd.DataFrame, date_column: str,
                      start_date: datetime, end_date: datetime) -> pd.DataFrame:
        """
        Filter DataFrame by date range.
        
        Args:
            df: DataFrame to filter
            date_column: Name of the date column
            start_date: Start date
            end_date: End date
            
        Returns:
            pd.DataFrame: Filtered DataFrame
        """
        mask = (df[date_column] >= start_date) & (df[date_column] <= end_date)
        return df.loc[mask]
    
    @staticmethod
    def calculate_statistics(df: pd.DataFrame, numeric_columns: List[str]) -> pd.DataFrame:
        """
        Calculate basic statistics for numeric columns.
        
        Args:
            df: DataFrame to analyze
            numeric_columns: List of numeric column names
            
        Returns:
            pd.DataFrame: Statistics summary
        """
        return df[numeric_columns].describe()

# Example usage
if __name__ == "__main__":
    # Initialize scraper
    scraper = BloombergScraper()
    
    # Example: Scrape and export data
    csv_path = scraper.scrape_and_export()
    
    if csv_path:
        print(f"Data successfully exported to: {csv_path}")
    else:
        print("Failed to export data")