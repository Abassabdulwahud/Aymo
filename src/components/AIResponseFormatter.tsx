import React from "react";
import ReactMarkdown from "react-markdown";
import { FileText, Film, Link2, MessageSquare, CheckCircle2, GitCompare } from "lucide-react";

interface AIResponseFormatterProps {
  content: string;
}

interface FormattedBlock {
  type: "title" | "heading" | "list" | "comparison" | "conclusion" | "paragraph";
  rawText: string;
  cleanedText: string;
  citations: string[];
}

interface ParsedSection {
  headingBlock: FormattedBlock | null;
  blocks: FormattedBlock[];
  allCitations: string[];
}

// Regex to match page citations [Page X] or timestamp citations [00:00:00 - 00:00:36]
// Optionally prefixed with a file name (e.g. Research.pdf [Page 18])
// Preceded by optional spaces which will be cleaned up
const CITATION_REGEX = /\s*(?:([a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+)\s+)?\[(Page\s+\d+|\d{1,2}:\d{2}(?::\d{2})?(?:\s*-\s*\d{1,2}:\d{2}(?::\d{2})?)?)\]/gi;

/**
 * Extracts all citations from a text block and returns the cleaned text and the list of formatted citations.
 */
function cleanCitations(text: string): { cleanedText: string; citations: string[] } {
  const citationsList: string[] = [];
  
  // Create a copy of the regex for matching
  const matchRegex = new RegExp(CITATION_REGEX);
  let match;
  
  while ((match = matchRegex.exec(text)) !== null) {
    const fileName = match[1];
    const location = match[2];
    let citationStr = "";
    
    if (fileName) {
      citationStr = `${fileName} [${location}]`;
    } else {
      // If it looks like a timestamp, it's a Video/Audio citation
      if (location.includes(":")) {
        citationStr = `Video [${location}]`;
      } else {
        citationStr = `PDF [${location}]`;
      }
    }
    
    if (!citationsList.includes(citationStr)) {
      citationsList.push(citationStr);
    }
  }
  
  // Remove citations from the text
  let cleanedText = text.replace(CITATION_REGEX, "");
  
  // Clean up punctuation spacing, e.g., "concept ." -> "concept."
  cleanedText = cleanedText.replace(/\s+([.,;!?])/g, "$1");
  // Clean up double spaces
  cleanedText = cleanedText.replace(/\s\s+/g, " ");
  // Clean up trailing spaces before newlines
  cleanedText = cleanedText.split("\n").map(line => line.trimEnd()).join("\n").trim();
  
  return { cleanedText, citations: citationsList };
}

/**
 * Parses raw markdown text into separate content blocks with detected types.
 */
function parseTextToBlocks(text: string): FormattedBlock[] {
  const normalizedText = text.replace(/\r\n/g, "\n");
  const lines = normalizedText.split("\n");
  const blocks: FormattedBlock[] = [];
  
  let currentBlockLines: string[] = [];
  let currentType: FormattedBlock["type"] = "paragraph";
  
  const commitBlock = () => {
    if (currentBlockLines.length === 0) return;
    const rawText = currentBlockLines.join("\n").trim();
    if (!rawText) {
      currentBlockLines = [];
      return;
    }
    
    const { cleanedText, citations } = cleanCitations(rawText);
    
    let type = currentType;
    if (type === "paragraph") {
      const lowerText = rawText.toLowerCase();
      // Detect Markdown tables or comparison indicators
      const isTable = rawText.includes("|") && rawText.includes("-");
      const hasComparisonKeywords = 
        lowerText.includes("comparison") || 
        lowerText.includes(" vs ") || 
        lowerText.includes("versus") || 
        lowerText.includes("compared to") ||
        lowerText.includes("contrast");
        
      if (isTable || hasComparisonKeywords) {
        type = "comparison";
      } else if (
        lowerText.startsWith("conclusion") || 
        lowerText.startsWith("in conclusion") || 
        lowerText.startsWith("finally") || 
        lowerText.startsWith("summary") ||
        lowerText.startsWith("to conclude") ||
        lowerText.startsWith("to sum up")
      ) {
        type = "conclusion";
      }
    }
    
    blocks.push({
      type,
      rawText,
      cleanedText,
      citations
    });
    
    currentBlockLines = [];
    currentType = "paragraph";
  };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith("# ")) {
      commitBlock();
      currentBlockLines.push(line);
      currentType = "title";
      commitBlock();
    } else if (trimmed.startsWith("## ") || trimmed.startsWith("### ") || trimmed.startsWith("#### ")) {
      commitBlock();
      currentBlockLines.push(line);
      currentType = "heading";
      commitBlock();
    } else if (trimmed.startsWith("* ") || trimmed.startsWith("- ") || trimmed.startsWith("+ ") || /^\d+\.\s+/.test(trimmed)) {
      if (currentType !== "list") {
        commitBlock();
        currentType = "list";
      }
      currentBlockLines.push(line);
    } else if (trimmed === "") {
      commitBlock();
    } else {
      if (currentType === "list") {
        // If it starts with spaces, it's a list item continuation
        if (line.startsWith(" ") || line.startsWith("\t")) {
          currentBlockLines.push(line);
        } else {
          commitBlock();
          currentBlockLines.push(line);
        }
      } else {
        currentBlockLines.push(line);
      }
    }
  }
  
  commitBlock();
  return blocks;
}

/**
 * Groups formatted blocks into structured sections (separated by headings/titles).
 */
function groupBlocksIntoSections(blocks: FormattedBlock[]): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection = {
    headingBlock: null,
    blocks: [],
    allCitations: []
  };
  
  for (const block of blocks) {
    if (block.type === "title" || block.type === "heading") {
      // Commit the previous section if it has content
      if (currentSection.headingBlock || currentSection.blocks.length > 0) {
        sections.push(currentSection);
      }
      // Start a new section
      currentSection = {
        headingBlock: block,
        blocks: [],
        allCitations: []
      };
    } else {
      currentSection.blocks.push(block);
      // Collect citations
      for (const cit of block.citations) {
        if (!currentSection.allCitations.includes(cit)) {
          currentSection.allCitations.push(cit);
        }
      }
    }
  }
  
  if (currentSection.headingBlock || currentSection.blocks.length > 0) {
    sections.push(currentSection);
  }
  
  return sections;
}

export function AIResponseFormatter({ content }: AIResponseFormatterProps) {
  if (!content) return null;

  const blocks = parseTextToBlocks(content);
  const sections = groupBlocksIntoSections(blocks);

  return (
    <div className="formatter-container">
      {sections.map((section, sIdx) => (
        <div key={sIdx} className="formatter-section">
          {section.headingBlock && (
            section.headingBlock.type === "title" ? (
              <h1 className="formatter-title">
                {section.headingBlock.cleanedText.replace(/^#\s+/, "")}
              </h1>
            ) : (
              <h2 className="formatter-heading">
                {section.headingBlock.cleanedText.replace(/^##+\s+/, "")}
              </h2>
            )
          )}
          
          {section.blocks.map((block, bIdx) => {
            switch (block.type) {
              case "conclusion":
                return (
                  <div key={bIdx} className="formatter-conclusion-card">
                    <div className="formatter-conclusion-icon-wrap">
                      <CheckCircle2 size={18} />
                    </div>
                    <div className="formatter-conclusion-content">
                      <ReactMarkdown>{block.cleanedText}</ReactMarkdown>
                    </div>
                  </div>
                );
              case "comparison":
                return (
                  <div key={bIdx} className="formatter-comparison-card">
                    <div className="formatter-comparison-icon-wrap">
                      <GitCompare size={18} />
                    </div>
                    <div className="formatter-comparison-content">
                      <ReactMarkdown>{block.cleanedText}</ReactMarkdown>
                    </div>
                  </div>
                );
              case "list":
                return (
                  <div key={bIdx} className="formatter-list">
                    <ReactMarkdown>{block.cleanedText}</ReactMarkdown>
                  </div>
                );
              default:
                return (
                  <div key={bIdx} className="formatter-paragraph">
                    <ReactMarkdown>{block.cleanedText}</ReactMarkdown>
                  </div>
                );
            }
          })}

          {section.allCitations.length > 0 && (
            <div className="formatter-section-sources">
              <span className="formatter-sources-label">Sources:</span>
              <div className="formatter-sources-list">
                {section.allCitations.map((citation, cIdx) => {
                  let Icon = FileText;
                  const lowerCitation = citation.toLowerCase();
                  if (
                    lowerCitation.includes("video") || 
                    lowerCitation.includes("audio") || 
                    lowerCitation.endsWith(".mp4") || 
                    lowerCitation.endsWith(".mp3") || 
                    lowerCitation.endsWith(".wav") || 
                    lowerCitation.endsWith(".avi")
                  ) {
                    Icon = Film;
                  } else if (
                    lowerCitation.includes("link") || 
                    lowerCitation.includes("http") || 
                    lowerCitation.includes(".com") || 
                    lowerCitation.includes(".org") || 
                    lowerCitation.includes(".net")
                  ) {
                    Icon = Link2;
                  } else if (lowerCitation.includes("note")) {
                    Icon = MessageSquare;
                  }

                  return (
                    <span key={cIdx} className="formatter-source-pill" title={citation}>
                      <Icon size={12} className="formatter-source-icon" />
                      <span>{citation}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
