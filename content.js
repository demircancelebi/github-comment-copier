(function() {
  'use strict';

  const DEFAULT_TEMPLATE = `a reviewer said this about the changes on {filePath} / on lines {lineNumbers}

{priority} - {title}

{body}

how can we address these concerns?`;

  const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>`;

  const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>`;

  // Track processed comments to avoid duplicates
  const processedComments = new WeakSet();

  // Cached template
  let cachedTemplate = DEFAULT_TEMPLATE;

  // Load template from storage
  async function loadTemplate() {
    try {
      const result = await chrome.storage.sync.get(['template']);
      cachedTemplate = result.template || DEFAULT_TEMPLATE;
    } catch (err) {
      console.error('Failed to load template:', err);
      cachedTemplate = DEFAULT_TEMPLATE;
    }
  }

  // Listen for storage changes to update template
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.template) {
      cachedTemplate = changes.template.newValue || DEFAULT_TEMPLATE;
    }
  });

  function extractFilePath(commentElement) {
    // Try to find file path from various sources

    // 1. PR review comment - look for file header above
    const fileHeader = commentElement.closest('.file')?.querySelector('.file-header [title], .file-info a, .file-header .Link--primary');
    if (fileHeader) {
      return fileHeader.getAttribute('title') || fileHeader.textContent?.trim();
    }

    // 2. Look for breadcrumb-style file path in the comment context
    const breadcrumb = commentElement.closest('.comment-holder, .review-comment, .js-comment')?.querySelector('.file-info, [data-path]');
    if (breadcrumb) {
      return breadcrumb.getAttribute('data-path') || breadcrumb.textContent?.trim();
    }

    // 3. Check for inline comment file path display or links to blob
    const commentBody = commentElement.querySelector('.comment-body, .markdown-body');
    if (commentBody) {
      // Look for links that contain file paths
      const fileLinks = commentBody.querySelectorAll('a[href*="/blob/"]');
      for (const link of fileLinks) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/blob\/[^/]+\/(.+?)(?:#|$)/);
        if (match) {
          // Clean up the path (remove line anchors, etc.)
          return match[1].split('#')[0];
        }
        // Check link text for file path pattern
        const text = link.textContent?.trim();
        if (text && text.includes('/') && text.match(/\.\w+$/)) {
          return text;
        }
      }
    }

    // 4. Look in the parent review thread container
    const reviewThread = commentElement.closest('.js-resolvable-timeline-thread-container, [data-file-path]');
    if (reviewThread) {
      const path = reviewThread.getAttribute('data-file-path');
      if (path) return path;
    }

    // 5. Check for path in the visible header text
    const pathText = commentElement.closest('.review-comment, .js-comment-container')
      ?.querySelector('.text-mono, .f6.color-fg-muted');
    if (pathText && pathText.textContent?.includes('/')) {
      return pathText.textContent.trim();
    }

    return null;
  }

  function extractLineNumbers(commentElement) {
    // Search the entire comment and its container for line info
    const container = commentElement.closest('.js-resolvable-timeline-thread-container, .review-thread, .inline-comment-form-container') || commentElement;
    const fullText = container.textContent || '';

    // Match patterns like "Comment on lines +534 to +536" or "Comment on line +534"
    const rangeMatch = fullText.match(/(?:Comment on |lines?\s*)\+?(\d+)\s*to\s*\+?(\d+)/i);
    if (rangeMatch) {
      return `+${rangeMatch[1]} to +${rangeMatch[2]}`;
    }

    const singleMatch = fullText.match(/(?:Comment on |line\s*)\+?(\d+)(?!\s*to)/i);
    if (singleMatch) {
      return `+${singleMatch[1]}`;
    }

    // Check for line number in blob links
    const blobLink = container.querySelector('a[href*="#L"]');
    if (blobLink) {
      const href = blobLink.getAttribute('href') || '';
      const lineMatch = href.match(/#L(\d+)(?:-L(\d+))?/);
      if (lineMatch) {
        const start = lineMatch[1];
        const end = lineMatch[2];
        return end ? `+${start} to +${end}` : `+${start}`;
      }
    }

    return null;
  }

  function extractBadgeOrLabel(commentElement) {
    const commentBody = commentElement.querySelector('.comment-body, .markdown-body');
    if (!commentBody) return null;

    // Look for any element at the start that contains P0-P4
    // This catches various badge implementations (spans, codes, g-emoji wrappers, etc.)
    const firstP = commentBody.querySelector('p');
    const searchRoot = firstP || commentBody;

    // Check all child elements of first paragraph/container
    const allElements = searchRoot.querySelectorAll('*');
    for (const el of allElements) {
      const text = el.textContent?.trim();
      if (text && /^P[0-4]$/i.test(text)) {
        return text.toUpperCase();
      }
      // Check alt/title attributes (for image-based badges)
      const alt = el.getAttribute('alt') || el.getAttribute('title') || '';
      if (/^P[0-4]$/i.test(alt.trim())) {
        return alt.trim().toUpperCase();
      }
    }

    // Check for img elements with P0-P4 in src/alt
    const images = commentBody.querySelectorAll('img');
    for (const img of images) {
      const alt = img.getAttribute('alt') || '';
      const src = img.getAttribute('src') || '';
      if (/P[0-4]/i.test(alt)) {
        const match = alt.match(/P[0-4]/i);
        if (match) return match[0].toUpperCase();
      }
      if (/[/=]P[0-4][./&]/i.test(src)) {
        const match = src.match(/P[0-4]/i);
        if (match) return match[0].toUpperCase();
      }
    }

    // Look for priority pattern in text at the very start
    const firstText = commentBody.textContent?.trim().substring(0, 10);
    const priorityMatch = firstText?.match(/^(P[0-4])\b/i);
    if (priorityMatch) {
      return priorityMatch[1].toUpperCase();
    }

    // Fallback: check innerHTML for P0-P4 pattern near the start
    const innerHTML = commentBody.innerHTML?.substring(0, 500) || '';
    const htmlMatch = innerHTML.match(/>P([0-4])</i) || innerHTML.match(/alt=["']P([0-4])["']/i);
    if (htmlMatch) {
      return `P${htmlMatch[1]}`;
    }

    return null;
  }

  function extractCommentTitle(commentElement) {
    // Look for the first heading or strong text as title
    const commentBody = commentElement.querySelector('.comment-body, .markdown-body');
    if (!commentBody) return null;

    // Skip patterns that are generic headers, not actual titles
    const skipPatterns = [
      /^💡?\s*Codex Review$/i,
      /^Review$/i,
      /^Code Review$/i,
      /^Suggestion$/i,
    ];

    const isGenericTitle = (text) => {
      return skipPatterns.some(p => p.test(text?.trim() || ''));
    };

    // Check for heading - but skip generic ones
    const headings = commentBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const heading of headings) {
      const text = heading.textContent?.trim();
      if (text && !isGenericTitle(text)) {
        return text;
      }
    }

    // Check for strong/bold text that might be a title
    const strongs = commentBody.querySelectorAll('strong, b');
    for (const strong of strongs) {
      const text = strong.textContent?.trim();
      // Skip priority labels and generic titles
      if (text && !/^P[0-4]$/i.test(text) && !isGenericTitle(text)) {
        return text;
      }
    }

    return null;
  }

  function extractCommentBody(commentElement, titleToRemove = null, priorityToRemove = null) {
    const commentBody = commentElement.querySelector('.comment-body, .markdown-body');
    if (!commentBody) return '';

    // Clone to avoid modifying the original
    const clone = commentBody.cloneNode(true);

    // Remove elements we don't want in the body
    clone.querySelectorAll([
      'button',
      '.btn',
      '.reaction-summary-item',
      'details',                    // "About Codex" expandable sections
      '.blob-wrapper',              // Code preview blocks
      '.file-actions',
      '.js-file-line-container',
      'table.highlight',            // Code tables
      '.snippet-clipboard-content',
      '.zeroclipboard-container',
    ].join(', ')).forEach(el => el.remove());

    // Get text content, preserving some structure
    let text = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();

        // Skip certain elements entirely
        if (tag === 'details' || tag === 'summary') {
          return; // Skip details/summary sections
        }

        if (tag === 'br') {
          text += '\n';
        } else if (tag === 'p' || tag === 'div' || tag === 'li' || /^h[1-6]$/.test(tag)) {
          if (text && !text.endsWith('\n')) text += '\n';
          node.childNodes.forEach(walk);
          if (!text.endsWith('\n')) text += '\n';
        } else if (tag === 'code' && node.parentElement?.tagName.toLowerCase() === 'pre') {
          text += '\n```\n' + node.textContent + '\n```\n';
        } else if (tag === 'code') {
          text += '`' + node.textContent + '`';
        } else if (tag === 'strong' || tag === 'b') {
          text += '**' + node.textContent + '**';
        } else if (tag === 'em' || tag === 'i') {
          text += '_' + node.textContent + '_';
        } else if (tag !== 'pre' && tag !== 'table') {
          node.childNodes.forEach(walk);
        }
      }
    };

    clone.childNodes.forEach(walk);

    let result = text.trim();

    // Remove title from body if it appears (avoid duplication)
    if (titleToRemove) {
      const titlePatterns = [
        new RegExp(`\\*\\*\\s*${escapeRegex(titleToRemove)}\\s*\\*\\*`, 'gi'),
        new RegExp(`^${escapeRegex(titleToRemove)}\\s*`, 'i'),
      ];
      for (const pattern of titlePatterns) {
        result = result.replace(pattern, '');
      }
    }

    // Remove priority label
    if (priorityToRemove) {
      result = result.replace(new RegExp(`\\s*\`?${escapeRegex(priorityToRemove)}\`?\\s*`, 'gi'), ' ');
    }

    // Remove boilerplate and noise patterns
    const boilerplatePatterns = [
      /Useful\?\s*React with.*$/im,
      /React with.*$/im,
      /👍\s*\/\s*👎\.?\s*/g,
      /💡\s*Codex Review\s*/gi,
      /ℹ️\s*About Codex.*$/ims,
      /Lines?\s+\d+\s+to\s+\d+\s+in\s+[a-f0-9]+/gi,  // "Lines 198 to 201 in 298df8e"
      /Your team has set up Codex.*$/ims,
      /Codex can also answer questions.*$/ims,
      /Open a pull request for review.*$/ims,
      /Mark a draft as ready.*$/ims,
      /Comment "@codex.*$/ims,
      /If Codex has suggestions.*$/ims,
      /Codex can also answer.*$/ims,
      /[\w/-]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|php|c|cpp|h)\s*\n\s*\n/gi, // File paths followed by blank lines
    ];
    for (const pattern of boilerplatePatterns) {
      result = result.replace(pattern, '');
    }

    // Clean up excessive whitespace
    result = result
      .replace(/\n\s*\n\s*\n/g, '\n\n')  // Max 2 newlines
      .replace(/  +/g, ' ')              // Collapse multiple spaces
      .trim();

    return result;
  }

  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function extractAuthor(commentElement) {
    // Look for author link/name
    const authorLink = commentElement.querySelector('.author, .timeline-comment-header .Link--secondary, a[data-hovercard-type="user"]');
    if (authorLink) {
      return authorLink.textContent?.trim();
    }

    // Check for author in header area
    const header = commentElement.querySelector('.timeline-comment-header, .comment-header');
    if (header) {
      const link = header.querySelector('a[href*="/"]');
      if (link && link.textContent) {
        return link.textContent.trim();
      }
    }

    return null;
  }

  function getPrUrl() {
    // Get the current PR/issue URL
    return window.location.href.split('#')[0];
  }

  function applyTemplate(template, data) {
    let result = template;

    // Replace placeholders with data
    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{${key}}`;
      result = result.split(placeholder).join(value || '');
    }

    // Clean up lines that only contain separator patterns
    result = result
      .replace(/^\s*-\s*$/gm, '')           // Remove lines that are just " - "
      .replace(/^\s*-\s+/gm, '')            // Remove leading " - " when priority is empty
      .replace(/^\s*\/\s*on lines\s*$/gm, '') // Remove "/ on lines" without actual lines
      .replace(/on\s+\/\s+on lines/g, '')   // Remove orphaned "on / on lines"
      .replace(/\n{3,}/g, '\n\n')           // Collapse multiple newlines
      .trim();

    return result;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('Failed to copy:', err);
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
      } catch (e) {
        document.body.removeChild(textarea);
        return false;
      }
    }
  }

  function createCopyButton(commentElement) {
    const button = document.createElement('button');
    button.className = 'gh-comment-copier-btn';
    button.innerHTML = COPY_ICON;
    button.title = 'Copy comment for AI agent';
    button.setAttribute('aria-label', 'Copy comment for AI agent');

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const priority = extractBadgeOrLabel(commentElement) || '';
      const title = extractCommentTitle(commentElement) || '';

      const data = {
        filePath: extractFilePath(commentElement) || '',
        lineNumbers: extractLineNumbers(commentElement) || '',
        priority,
        title,
        body: extractCommentBody(commentElement, title, priority) || '',
        author: extractAuthor(commentElement) || '',
        prUrl: getPrUrl() || ''
      };

      const text = applyTemplate(cachedTemplate, data);
      const success = await copyToClipboard(text);

      if (success) {
        button.innerHTML = CHECK_ICON;
        button.classList.add('gh-comment-copier-btn--success');
        setTimeout(() => {
          button.innerHTML = COPY_ICON;
          button.classList.remove('gh-comment-copier-btn--success');
        }, 2000);
      }
    });

    return button;
  }

  function findReactionBar(commentElement) {
    // Find the reaction/action bar at the bottom of the comment
    const reactionBar = commentElement.querySelector('.comment-reactions, .js-comment-reactions-options, .reaction-summary-item')?.parentElement;
    if (reactionBar) return reactionBar;

    // Look for the emoji picker button area
    const emojiArea = commentElement.querySelector('[data-view-component="true"].js-reaction-popover-container')?.parentElement;
    if (emojiArea) return emojiArea;

    // Look for timeline-comment-actions area
    const actionsBar = commentElement.querySelector('.timeline-comment-actions, .comment-actions');
    if (actionsBar) return actionsBar;

    // Fallback: find the bottom of the comment body
    const commentBody = commentElement.querySelector('.comment-body, .markdown-body');
    if (commentBody) return commentBody.parentElement;

    return null;
  }

  function addCopyButtonToComment(commentElement) {
    if (processedComments.has(commentElement)) return;

    // Check if it's actually a comment with content
    const hasCommentBody = commentElement.querySelector('.comment-body, .markdown-body, .review-comment-contents');
    if (!hasCommentBody) return;

    // Skip if button already exists (handles nested selectors)
    if (commentElement.querySelector('.gh-comment-copier-btn')) return;

    // Skip if this is nested inside another comment that will be processed
    if (commentElement.parentElement?.closest('.review-comment, .timeline-comment, .js-comment-container')) return;

    processedComments.add(commentElement);

    const insertLocation = findReactionBar(commentElement);
    if (!insertLocation) return;

    const button = createCopyButton(commentElement);

    // Create a wrapper to position the button
    const wrapper = document.createElement('div');
    wrapper.className = 'gh-comment-copier-wrapper';
    wrapper.appendChild(button);

    // Insert after the reaction bar or at the end of comment
    if (insertLocation.nextSibling) {
      insertLocation.parentNode.insertBefore(wrapper, insertLocation.nextSibling);
    } else {
      insertLocation.parentNode.appendChild(wrapper);
    }
  }

  function processComments() {
    // Selectors for various GitHub comment types
    const selectors = [
      '.review-comment',           // PR review inline comments
      '.timeline-comment',         // Timeline comments (issues, PRs)
      '.js-comment-container',     // Generic comment containers
      '.js-comment',               // Another generic comment type
      '.discussion-timeline-item', // Discussion items
      '.review-thread-reply',      // Review thread replies
      '.js-resolvable-timeline-thread-container .comment', // Resolvable threads
    ];

    const comments = document.querySelectorAll(selectors.join(', '));
    comments.forEach(addCopyButtonToComment);
  }

  // Initialize
  async function init() {
    await loadTemplate();
    processComments();

    // Watch for dynamically loaded comments
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldProcess = true;
          break;
        }
      }
      if (shouldProcess) {
        // Debounce to avoid excessive processing
        clearTimeout(observer._timeout);
        observer._timeout = setTimeout(processComments, 100);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  init();
})();
