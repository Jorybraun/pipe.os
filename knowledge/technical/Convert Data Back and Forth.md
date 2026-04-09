**Coding Challenge**

### **Available JSON Files**

The following JSON files are the output of **Azure Document Intelligence**:

- [**Scope of Funding Summary (CN) - JSON**](https://huggingface.co/spaces/compustar/coding-challenge/resolve/main/Scope-of-Funding-Summary-CN.pdf.json?download=true) (141KB)
- [**IMF World Economic Outlook 2024 (October) - JSON**](https://huggingface.co/spaces/compustar/coding-challenge/resolve/main/IMF%20World%20Economic%20Outlook%202024%20October.pdf.json?download=true) (29.1MB)

The JSON structure follows the specifications outlined in the **Azure AI Services REST API**:  
🔗 [Document Models - Get Analyze Result](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/get-analyze-result?view=rest-aiservices-v4.0%20\(2024-11-30\)&tabs=HTTP#analyzeresult)

---

## **Challenges**

### 🔹 **Challenge 1: Convert JSON to Markdown**

Write a program in any language (using LLMs or AI-powered IDEs if desired) to convert the JSON files into **Markdown** format. The output should match the structure of these example files:

- [**Scope of Funding Summary (CN) - Markdown**](https://huggingface.co/spaces/compustar/coding-challenge/resolve/main/Scope-of-Funding-Summary-CN.pdf.md?download=true)
- [**IMF World Economic Outlook 2024 (October) - Markdown**](https://huggingface.co/spaces/compustar/coding-challenge/resolve/main/IMF%20World%20Economic%20Outlook%202024%20October.pdf.md?download=true)

💡 **Hint:** Start with the **smaller file** (141KB) before working with the larger one (29.1MB). This will help you debug and refine your approach efficiently.

---

### 🔹 **Challenge 2: Convert JSON to HTML**

Develop a program to transform the JSON files into **HTML**, ensuring that the output matches the format produced by:

🔗 [**Free Markdown to HTML Converter**](https://markdowntohtml.com/)

💡 **Hint:** Once again, process the **smaller JSON file first** to verify your approach before handling the larger dataset.

---

### 🔹 **Challenge 3: Convert JSON to Word Document**

Write a program to convert the JSON files into **Word (.docx) files**, ensuring that they visually match the **HTML output** from Challenge 2.

💡 **Hint:** If your markdown-to-HTML pipeline is working correctly, you can use **Markdown-to-Word conversion tools** (such as Pandoc) or a direct **HTML-to-Word approach** to generate consistent results.

---

💡 **You can use any programming language, framework, or AI-powered development tool to complete these challenges.** Happy coding! 🚀