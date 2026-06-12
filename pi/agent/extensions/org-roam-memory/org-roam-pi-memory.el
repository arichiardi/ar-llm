;;; org-roam-pi.el --- Pure Elisp API for pi's org-roam memory extension -*- lexical-binding: t; -*-

;;; Commentary:

;; Zero-DB interface to org-roam for the pi coding agent.
;; All node discovery, link traversal, and queries use file scanning + org-element.
;; All public functions return JSON-encoded strings suitable for
;; `emacsclient --eval' consumption.

;;; Code:

(require 'json)
(require 'seq)
(require 'subr-x)
(require 'cl-lib)
(require 'org)
(require 'org-element)
(require 'epa-file)

;;;; Debug Logging
;; Set env var ORG_ROAM_PI_MEMORY_DEBUG=true to log to /tmp/org-roam-pi-memory-debug.log
(defvar org-roam-pi--debug-log nil
  "Path to debug log file (set at runtime).")
(defvar org-roam-pi--context-log nil
  "Path to context memory log file (set at runtime).")

(defun org-roam-pi-set-debug-logs (log-file context-file)
  "Set debug log paths from config, expanding ~ if needed."
  (setq org-roam-pi--debug-log (expand-file-name log-file)
        org-roam-pi--context-log (expand-file-name context-file)))

(defun org-roam-pi--init-logs ()
  "Initialize log file paths using `make-temp-file'."
  (unless org-roam-pi--debug-log
    (setq org-roam-pi--debug-log (make-temp-file "org-roam-pi-memory-debug-" nil ".log")))
  (unless org-roam-pi--context-log
    (setq org-roam-pi--context-log (make-temp-file "org-roam-pi-memory-context-" nil ".log"))))

(defun org-roam-pi--dbg (msg)
  "Log MSG to debug file if ORG_ROAM_PI_MEMORY_DEBUG is set."
  (when (string-equal (or (getenv "ORG_ROAM_PI_MEMORY_DEBUG") "") "true")
    (with-temp-buffer
      (insert (format "[%s] [elisp] %s\n" (current-time-string) msg))
      (write-region (point-min) (point-max)
                    org-roam-pi--debug-log nil 'silent))))

;;;; Configuration

(defcustom org-roam-pi-directory (expand-file-name "~/git/ar-org/zettelkasten/")
  "Org-roam directory used by pi tools."
  :type 'string
  :group 'org-roam)

(defcustom org-roam-pi-gpg-encrypt-to '("a.richiardi.work@gmail.com")
  "GPG recipients for encrypting new notes."
  :type '(repeat string)
  :group 'org-roam)

(defcustom org-roam-pi-journal-directory "journal"
  "Journal directory relative to `org-roam-pi-directory'."
  :type 'string
  :group 'org-roam)

(defcustom org-roam-pi-entry-nodes '("Me")
  "Entry node titles for memory context."
  :type '(repeat string)
  :group 'org-roam)

(defcustom org-roam-pi-entry-node-cap 5
  "Maximum entry nodes to include in memory context."
  :type 'integer
  :group 'org-roam)

(defcustom org-roam-pi-journal-recent-days 7
  "Days of journal content to decrypt and include (full text)."
  :type 'integer
  :group 'org-roam)

(defcustom org-roam-pi-journal-titles-only-days 14
  "Days of journal entries to show titles-only for."
  :type 'integer
  :group 'org-roam)

(defcustom org-roam-pi-ambient-cap-chars 10000
  "Maximum characters for ambient memory context."
  :type 'integer
  :group 'org-roam)

(defcustom org-roam-pi-include-open-todos t
  "Whether to include open TODOs in memory context."
  :type 'boolean
  :group 'org-roam)


;;;; Internal node representation

;; Nodes are plain alists with keys:
;;   title id file level todo priority tags aliases properties refs

(defvar org-roam-pi--node-cache nil
  "Cache of all scanned nodes. Invalidated on each public call.")

(defvar org-roam-pi--link-cache nil
  "Cache of (source-id . (dest-id ...)) link map. Invalidated on each public call.")


;;;; Bootstrap

(defun org-roam-pi--json-get (cfg key)
  "Get KEY from CFG plist, converting JSON arrays to proper lists.
When Emacs reads JSON as plist, arrays become vectors like [\"a\" \"b\"].
This function converts them to Elisp lists."
  (let ((val (plist-get cfg key)))
    (if (vectorp val)
        (append val nil)
      val)))

(defun org-roam-pi-apply-config (config-path)
  "Read CONFIG-PATH (JSON) and apply all org-roam-pi settings.
Called once at extension start before any other function."
  (let ((cfg (with-temp-buffer
               (insert-file-contents config-path)
               (let (json-object-type)
                 (setf json-object-type 'plist)
                 (json-read)))))
    (when (org-roam-pi--json-get cfg :roam-directory)
      (setq org-roam-pi-directory (expand-file-name (org-roam-pi--json-get cfg :roam-directory))))
    (when (org-roam-pi--json-get cfg :gpg-encrypt-to)
      (setq org-roam-pi-gpg-encrypt-to (org-roam-pi--json-get cfg :gpg-encrypt-to)))
    (when (org-roam-pi--json-get cfg :journal-directory)
      (setq org-roam-pi-journal-directory (org-roam-pi--json-get cfg :journal-directory)))
    (when (org-roam-pi--json-get cfg :entry-nodes)
      (setq org-roam-pi-entry-nodes (org-roam-pi--json-get cfg :entry-nodes)))
    (when (org-roam-pi--json-get cfg :entry-node-cap)
      (setq org-roam-pi-entry-node-cap (org-roam-pi--json-get cfg :entry-node-cap)))
    (when (org-roam-pi--json-get cfg :ambient-cap-chars)
      (setq org-roam-pi-ambient-cap-chars (org-roam-pi--json-get cfg :ambient-cap-chars)))
    (when (org-roam-pi--json-get cfg :journal-recent-days)
      (setq org-roam-pi-journal-recent-days (org-roam-pi--json-get cfg :journal-recent-days)))
    (when (org-roam-pi--json-get cfg :journal-titles-only-days)
      (setq org-roam-pi-journal-titles-only-days (org-roam-pi--json-get cfg :journal-titles-only-days)))
    (when (org-roam-pi--json-get cfg :include-open-todos)
      (setq org-roam-pi-include-open-todos (org-roam-pi--json-get cfg :include-open-todos)))
    ;; Debug log paths from config (fall back to make-temp-file if not set)
    (let ((debug-cfg (org-roam-pi--json-get cfg :debug)))
      (if (and debug-cfg (plist-get debug-cfg :log-file) (plist-get debug-cfg :context-file))
          (org-roam-pi-set-debug-logs
           (plist-get debug-cfg :log-file)
           (plist-get debug-cfg :context-file))
        (org-roam-pi--init-logs)))))

(defun org-roam-pi--bootstrap ()
  "Ensure org-roam directory is set and caches are fresh."
  (org-roam-pi--init-logs)

  (org-roam-pi--scan-nodes))


;;;; JSON helpers

(defun org-roam-pi--json (obj)
  "Return OBJ as a JSON string."
  (json-encode obj))

(defun org-roam-pi--error (msg)
  "Return an error JSON object with MSG."
  (org-roam-pi--json `(("error" . ,msg))))


;;;; Read file content (with GPG decryption via epa-file)

(defun org-roam-pi--read-file (file-path)
  "Read FILE-PATH contents, decrypting .gpg files transparently.
Returns the string content or nil on error."
  (if (not (file-exists-p file-path))
      nil
    (condition-case err
        (with-temp-buffer
          (insert-file-contents file-path)
          (buffer-substring-no-properties (point-min) (point-max)))
      ((error)
       (message "org-roam-pi: failed to read %s: %s" file-path (error-message-string err))
       nil))))


;;;; Walk org files in roam directory

(defun org-roam-pi--all-org-files ()
  "Return list of all .org and .org.gpg files under org-roam directory."
  (let ((files '()))
    (dolist (f (directory-files-recursively org-roam-pi-directory "\\(\\.org\\|\\.org\\.gpg\\)$"))
      (push f files))
    files))


;;;; Parse a single file into node alists

(defun org-roam-pi--extract-props (headline)
  "Extract properties drawer from HEADLINE as an alist."
  (let* ((props-drawer (org-element-map headline 'property-drawer #'identity))
         (entries (when props-drawer (org-element-contents (car props-drawer))))
         (pairs '()))
    (dolist (entry entries)
      (when (eq (org-element-type entry) 'node-property)
        (let ((key (org-element-property :key entry))
              (val (org-element-property :value entry)))
          (when key
            (push (cons key (or val "")) pairs)))))
    (when pairs pairs)))

(defun org-roam-pi--headline-to-node (headline file-path)
  "Convert org-element HEADLINE to a node alist for FILE-PATH.
Returns nil if headline has no ID property."
  (let* ((props (org-roam-pi--extract-props headline))
         (id (cdr (assoc "ID" props))))
    (if (not id)
        nil
      (let* ((raw-title (org-element-property :raw-value headline))
             (level (org-element-property :level headline))
             (todo-kw (org-element-property :todo-keyword headline))
             (priority (org-element-property :priority headline))
             (aliases-raw (cdr (assoc "ROAM_ALIASES" props)))
             (aliases (when aliases-raw
                        (split-string aliases-raw "," t "[ \t]*,[ \t]*")))
             (refs-raw (cdr (assoc "ROAM_REFS" props)))
             (refs (when refs-raw
                     (split-string refs-raw "," t "[ \t]*,[ \t]*")))
             (tags-prop (cdr (assoc "TAGS" props)))
             (tags (when tags-prop
                     (split-string tags-prop ":" t "[ \t]*:[ \t]*"))))
        `((title . ,(or raw-title ""))
          (id . ,id)
          (file . ,file-path)
          (level . ,level)
          (todo . ,(or todo-kw ""))
          (priority . ,(if priority (char-to-string priority) ""))
          (tags . ,(or tags '()))
          (aliases . ,(or aliases '()))
          (refs . ,(or refs '()))
          (properties . ,props))))))

(defun org-roam-pi--extract-file-node (content file-path)
  "Extract file-level node from CONTENT string if it has an ID property.
Uses regex to find :PROPERTIES: drawer at top of file.
Returns a node alist or nil." 
  (with-temp-buffer
    (insert content)
    (goto-char (point-min))
    (if (not (re-search-forward "^:PROPERTIES:" nil t))
        nil
      ;; Find end of properties drawer and extract keys within bounds
      (let* ((drawer-end (save-excursion (re-search-forward "^:END:" nil t)))
             (props '())
             id title)
        (when drawer-end
          (while (and (< (point) drawer-end)
                      (re-search-forward "^:\\([A-Z_-]+\\):[ \t]+\\(.*?\\)$" drawer-end t))
            (let ((key (match-string 1))
                  (val (match-string 2)))
              (push (cons key val) props)
              (when (string-equal key "ID") (setq id val)))))
        ;; Get title from #+TITLE or filename
        (goto-char (point-min))
        (when (re-search-forward "^#\\+TITLE:[ \t]+\\(.*?\\)$" nil t)
          (setq title (match-string 1)))
        (unless title
          (setq title (file-name-sans-extension (file-name-nondirectory file-path))))
        (when id
          `((title . ,title)
            (id . ,id)
            (file . ,file-path)
            (level . 0)
            (todo . "")
            (priority . "")
            (tags . ())
            (aliases . ())
            (refs . ())
            (properties . ,(nreverse props))))))))

(defun org-roam-pi--extract-node-body (node &optional max-chars)
  "Extract first-level body text from NODE's file.
Returns a string of paragraphs and bullet points, or nil if empty.
MAX-CHARS limits output length (default 500)."
  (let ((file (cdr (assoc 'file node)))
        (level (or (cdr (assoc 'level node)) 0)))
    (when file
      (let ((content (org-roam-pi--read-file file)))
        (when content
          (with-temp-buffer
            (insert content)
            (goto-char (point-min))
            (let* ((max-len (or max-chars 500))
                   (headline-title (cdr (assoc 'title node)))
                   (body-start nil)
                   (body-end nil))
              ;; Find the headline (or file start for level 0)
              (if (= level 0)
                  ;; File-level node: skip properties drawer and keywords
                  (progn
                    (when (re-search-forward "^:PROPERTIES:" nil t)
                      (when (re-search-forward "^:END:" nil t)
                        (forward-line 1)))
                    ;; Skip #+KEYWORDS until we hit content
                    (while (looking-at "#\\+")
                      (forward-line 1))
                    (setq body-start (point)))
                ;; Headline-level node: find the headline
                (when (and headline-title
                           (re-search-forward (format "^\\*+ %s$" (regexp-quote headline-title)) nil t))
                  ;; Move to line after headline
                  (forward-line 1)
                  ;; Skip property drawer if present
                  (when (looking-at ":PROPERTIES:")
                    (when (re-search-forward "^:END:" nil t)
                      (forward-line 1)))
                  (setq body-start (point))))
              ;; Extract body until next headline at same/lower level or end
              (when body-start
                (save-excursion
                  (goto-char body-start)
                  (when (re-search-forward (format "^\\*\\{1,%d\\} " (1+ level)) nil t)
                    (setq body-end (match-beginning 0))))
                (let ((raw-body (buffer-substring-no-properties 
                                 body-start 
                                 (or body-end (point-max)))))
                  ;; Clean up: remove trailing whitespace, collapse multiple newlines
                  (setq raw-body (replace-regexp-in-string "\n\\{3,\\}" "\n\n" raw-body))
                  (setq raw-body (replace-regexp-in-string "[ \t]*\n[ \t]*" "\n" raw-body))
                  (setq raw-body (string-trim raw-body))
                  ;; Truncate if needed
                  (when (> (length raw-body) max-len)
                    (setq raw-body (substring raw-body 0 max-len)))
                  raw-body)))))))))
(defun org-roam-pi--parse-file-nodes (file-path)
  "Parse FILE-PATH and return list of node alists found in it.
Includes both headline-level and file-level nodes." 
  (let ((content (org-roam-pi--read-file file-path)))
    (if (not content)
        '()
      (with-temp-buffer
        (insert content)
        (org-mode)
        (let* ((tree (org-element-parse-buffer))
               (headlines (org-element-map tree 'headline #'identity))
               (nodes '()))
          ;; File-level node (e.g., work.org.gpg with top-level :ID:)
          (when-let* ((file-node (org-roam-pi--extract-file-node content file-path)))
            (push file-node nodes))
          ;; Headline-level nodes
          (dolist (hl headlines)
            (let ((node (org-roam-pi--headline-to-node hl file-path)))
              (when node
                (push node nodes))))
          nodes)))))

(defun org-roam-pi--scan-nodes ()
  "Scan all org files, build node cache and link cache."
  (setq org-roam-pi--node-cache '()
        org-roam-pi--link-cache nil)
  (let ((all-files (org-roam-pi--all-org-files)))
    ;; Parse nodes from each file
    (dolist (f all-files)
      (dolist (node (org-roam-pi--parse-file-nodes f))
        (push node org-roam-pi--node-cache)))
    ;; Build link cache by scanning file contents for [[id:UUID...]] patterns
    (let ((link-map (make-hash-table :test 'equal)))
      (dolist (f all-files)
        (let ((content (org-roam-pi--read-file f)))
          (when content
            ;; Find all org-roam ID links in this file
            (let ((all-nodes-in-file
                   (seq-filter (lambda (n) (string= (cdr (assoc 'file n)) f))
                               org-roam-pi--node-cache)))
              (dolist (src-node all-nodes-in-file)
                (let ((src-id (cdr (assoc 'id src-node))))
                  ;; Find all [[id:DEST_ID...]] references in this file's content
                  (let ((matches '()))
                    (with-temp-buffer
                      (insert content)
                      (goto-char (point-min))
                      (while (re-search-forward "\\[\\[id:\\([a-fA-F0-9-]+\\)" nil t)
                        (push (match-string 1) matches)))
                    (dolist (dest-id (seq-uniq matches))
                      (let ((existing (gethash src-id link-map '())))
                        (if (not (member dest-id existing))
                            (puthash src-id (cons dest-id existing) link-map)))))))
            ;; Also scan for unheadlined file-level links (top-level node links to others)
            ;; This handles links in the file that aren't under any specific headline
            )))
      (setq org-roam-pi--link-cache link-map)))))

;;;; Node accessor helpers (work on our alists)

(defun org-roam-pi--node-title (node) (cdr (assoc 'title node)))
(defun org-roam-pi--node-id (node) (cdr (assoc 'id node)))
(defun org-roam-pi--node-file (node) (cdr (assoc 'file node)))
(defun org-roam-pi--node-level (node) (cdr (assoc 'level node)))
(defun org-roam-pi--node-todo (node) (cdr (assoc 'todo node)))
(defun org-roam-pi--node-priority (node) (cdr (assoc 'priority node)))
(defun org-roam-pi--node-tags (node) (cdr (assoc 'tags node)))
(defun org-roam-pi--node-aliases (node) (cdr (assoc 'aliases node)))
(defun org-roam-pi--node-refs (node) (cdr (assoc 'refs node)))
(defun org-roam-pi--node-properties (node) (cdr (assoc 'properties node)))

(defun org-roam-pi--node-list ()
  "Return all scanned nodes."
  org-roam-pi--node-cache)

(defun org-roam-pi--node-from-id (id)
  "Find a node by ID from the cache."
  (seq-find (lambda (n) (string= (cdr (assoc 'id n)) id))
            org-roam-pi--node-cache))

(defun org-roam-pi--node-from-title (title)
  "Find a node by TITLE from the cache."
  (seq-find (lambda (n) (string= (cdr (assoc 'title n)) title))
            org-roam-pi--node-cache))

(defun org-roam-pi--node-outgoing (node-id)
  "Return list of destination IDs linked FROM NODE-ID."
  (gethash node-id org-roam-pi--link-cache '()))

(defun org-roam-pi--node-incoming (node-id)
  "Return list of source IDs that link TO NODE-ID."
  (let ((sources '()))
    (maphash (lambda (src dests)
               (when (member node-id dests)
                 (push src sources)))
             org-roam-pi--link-cache)
    sources))

;;;; Node-to-map converter (for JSON output)

(defun org-roam-pi--node-to-map (node &optional relative-dir)
  "Convert NODE alist to a plist map for JSON output.
If RELATIVE-DIR is given, make file paths relative to it."
  (let* ((file (org-roam-pi--node-file node))
         (rel-file (if relative-dir
                       (file-relative-name file relative-dir)
                     file)))
    `((title . ,(org-roam-pi--node-title node))
      (id . ,(org-roam-pi--node-id node))
      (file . ,rel-file)
      (level . ,(org-roam-pi--node-level node))
      (todo . ,(or (org-roam-pi--node-todo node) ""))
      (priority . ,(or (org-roam-pi--node-priority node) ""))
      (tags . ,(or (org-roam-pi--node-tags node) '()))
      (aliases . ,(or (org-roam-pi--node-aliases node) '()))
      (refs . ,(or (org-roam-pi--node-refs node) '()))
      (properties . ,(or (org-roam-pi--node-properties node) '())))))

;;;; GPG encryption helper

(defun org-roam-pi--encrypt-and-save (content target-path recipients)
  "Encrypt CONTENT and write to TARGET-PATH for RECIPIENTS.
Returns t on success, error string on failure."
  (let* ((dir (file-name-directory target-path))
         (tmp-file (make-temp-file "org-roam-pi" nil ".org")))
    (if (not (file-directory-p dir))
        (make-directory dir t))
    (with-temp-buffer
      (insert content)
      (write-region (point-min) (point-max) tmp-file nil 'nomesg))
    (unwind-protect
        (condition-case err
            (progn
              (call-process "gpg" nil '(t nil) nil
                            "--batch" "--yes" "--trust-model" "always" "-e"
                            (mapconcat (lambda (r) (format "-r %s" r)) recipients " ")
                            tmp-file)
              (let ((gpg-output (concat tmp-file ".gpg")))
                (if (file-exists-p gpg-output)
                    (progn
                      (rename-file gpg-output target-path 'overwrite)
                      t)
                  (format "GPG did not produce encrypted file"))))
          ((error e)
           (error-message-string e)))
      (when (file-exists-p tmp-file)
        (delete-file tmp-file))
      (when (file-exists-p (concat tmp-file ".gpg"))
        (delete-file (concat tmp-file ".gpg"))))))

;;;; Generate UUID for org IDs

(defun org-roam-pi--generate-id ()
  "Generate a 32-char uppercase hex ID suitable for org-roam."
  (let ((uuid (replace-regexp-in-string "-" "" (uuid-generate))))
    (upcase uuid)))

;;;; Pick file for title (keyword matching)

(defun org-roam-pi--pick-file-for-title (title)
  "Pick an existing file whose title matches words in TITLE.
Returns a file path string or nil."
  (let* ((words (split-string (downcase title) "[^a-z0-9]+" t))
         (candidates '()))
    (dolist (node (org-roam-pi--node-list))
      (when (and (= (org-roam-pi--node-level node) 0)
                 (not (string-match-p "/journal/" (org-roam-pi--node-file node))))
        (let* ((file-title (downcase (org-roam-pi--node-title node)))
               (score (length (seq-filter (lambda (w) (string-match-p w file-title)) words))))
          (when (> score 0)
            (push `((title . ,(org-roam-pi--node-title node))
                    (file . ,(org-roam-pi--node-file node))
                    (score . ,score))
                  candidates)))))
    (setq candidates (seq-sort (lambda (a b)
                                 (> (cdr (assoc 'score a))
                                    (cdr (assoc 'score b))))
                               candidates))
    (when candidates
      (cdr (assoc 'file (car candidates))))))

;;;###autoload
(defun org-roam-pi-search (query &optional max-results)
  "Search org-roam nodes by QUERY across titles, aliases, and properties.
MAX-RESULTS caps the output (default 10).
Returns a JSON string."
  (org-roam-pi--bootstrap)
  (org-roam-pi--dbg (format "search query=%s max=%s" query (or max-results 10)))
  (let* ((max (or max-results 10))
         (results '())
         (query-re (regexp-opt (list query) t)))
    (dolist (node (org-roam-pi--node-list))
      (when (< (length results) max)
        (let* ((title (org-roam-pi--node-title node))
               (props (org-roam-pi--node-properties node))
               (aliases (org-roam-pi--node-aliases node))
               (matched (or (string-match-p query-re title)
                            (seq-some (lambda (a) (string-match-p query-re a)) aliases)
                            (and props (string-match-p query-re (prin1-to-string props))))))
          (when matched
            (push (org-roam-pi--node-to-map node org-roam-pi-directory) results)))))
    (org-roam-pi--dbg (format "search found %d results" (length results)))
    (org-roam-pi--json (nreverse results))))

;;;###autoload
(defun org-roam-pi-retrieve (&optional node-id title)
  "Retrieve full content of a node by NODE-ID or TITLE.
Returns a JSON string with title, file, and content."
  (org-roam-pi--bootstrap)
  (org-roam-pi--dbg (format "retrieve id=%s title=%s" node-id title))
  (let ((id node-id)
        (node nil))
    ;; Resolve title -> id if needed
    (if (not id)
        (when title
          (setq node (org-roam-pi--node-from-title title))
          (when node (setq id (org-roam-pi--node-id node)))))
    ;; Find by id
    (if (not (and id node))
        (setq node (org-roam-pi--node-from-id id)))
    (if (not node)
        (org-roam-pi--error "Node not found")
      (let* ((file (org-roam-pi--node-file node))
             (level (org-roam-pi--node-level node))
             (full-content (org-roam-pi--read-file file))
             (content full-content))
        ;; For headline-level nodes, extract only the subtree
        (when (and full-content (> level 0))
          (with-temp-buffer
            (insert full-content)
            (goto-char (point-min))
            (when (re-search-forward (format "^\*\\{1,%d\\} %s$" level (regexp-quote (org-roam-pi--node-title node))) nil t)
              (let ((start (point-marker)))
                (org-end-of-subtree t t)
                (setq content (buffer-substring-no-properties start (point-marker)))))))
        (if content
            (let ((max-len 20000)
                  (truncated nil))
              (when (> (length content) max-len)
                (setq content (substring content 0 max-len)
                      truncated t))
              (org-roam-pi--json `((title . ,(org-roam-pi--node-title node))
                                    (file . ,file)
                                    (content . ,content)
                                    (truncated . ,truncated))))
          (org-roam-pi--error (format "Could not read file: %s" file)))))))

;;;###autoload
(defun org-roam-pi-links (&optional node-id title direction)
  "Show graph neighbors of a node.
DIRECTION is \"outgoing\", \"incoming\", or \"both\" (default).
Returns a JSON string."
  (org-roam-pi--bootstrap)
  (org-roam-pi--dbg (format "links id=%s title=%s dir=%s" node-id title direction))
  (let ((id node-id)
        (node nil))
    (if (not id)
        (when title
          (setq node (org-roam-pi--node-from-title title))
          (when node (setq id (org-roam-pi--node-id node)))))
    (if (not id)
        (org-roam-pi--error "Provide node_id or title")
      (if (not node)
          (setq node (org-roam-pi--node-from-id id)))
      (if (not node)
          (org-roam-pi--error "Node not found")
        (let* ((dir (or direction "both"))
               (outgoing '())
               (incoming '()))
          ;; Outgoing links from cache
          (when (or (string= dir "outgoing") (string= dir "both"))
            (dolist (dest-id (org-roam-pi--node-outgoing id))
              (let ((dest-node (org-roam-pi--node-from-id dest-id)))
                (when dest-node
                  (push (org-roam-pi--node-to-map dest-node org-roam-pi-directory) outgoing)))))
          ;; Incoming links from cache
          (when (or (string= dir "incoming") (string= dir "both"))
            (dolist (src-id (org-roam-pi--node-incoming id))
              (let ((src-node (org-roam-pi--node-from-id src-id)))
                (when src-node
                  (push (org-roam-pi--node-to-map src-node org-roam-pi-directory) incoming)))))
          (org-roam-pi--json `((title . ,(org-roam-pi--node-title node))
                                (id . ,id)
                                (outgoing . ,(nreverse outgoing))
                                (incoming . ,(nreverse incoming)))))))))

;;;###autoload
(defun org-roam-pi-graph (&optional node-id title max-hops)
  "Multi-hop BFS traversal from a seed node.
MAX-HOPS defaults to 2, maximum 3.
Returns a JSON string."
  (org-roam-pi--bootstrap)
  (let ((id node-id)
  (org-roam-pi--dbg (format "graph id=%s title=%s hops=%s" node-id title (or max-hops 2)))
        (node nil))
    (if (not id)
        (when title
          (setq node (org-roam-pi--node-from-title title))
          (when node (setq id (org-roam-pi--node-id node)))))
    (if (not id)
        (org-roam-pi--error "Provide node_id or title")
      (let* ((max-hops (min (or max-hops 2) 3))
             (visited (list id))
             (queue `(((id . ,id) (hop . 0))))
             (results '()))
        (while queue
          (let* ((current (car queue)))
            (setq queue (cdr queue))
            (let* ((cur-id (cdr (assoc 'id current)))
                   (cur-hop (cdr (assoc 'hop current)))
                   (cur-node (org-roam-pi--node-from-id cur-id)))
              (when cur-node
                (push `((title . ,(org-roam-pi--node-title cur-node))
                        (id . ,cur-id)
                        (hop . ,cur-hop))
                      results))
                ;; Get neighbors from link cache
                (when (< cur-hop max-hops)
                  (let* ((neighbors (seq-uniq
                                     (append (org-roam-pi--node-outgoing cur-id)
                                             (org-roam-pi--node-incoming cur-id)))))
                    (dolist (nid neighbors)
                      (if (not (member nid visited))
                          (progn
                            (push nid visited)
                            (push `((id . ,nid) (hop . ,(1+ cur-hop))) queue)))))))))
        (org-roam-pi--json (nreverse results))))))

;;;###autoload
(defun org-roam-pi-create (title content &optional file tags)
  "Create a new note in org-roam.
TITLE is the node title, CONTENT is the body text.
FILE is an optional target path (auto-picked if omitted).
TAGS is an optional list of tag strings.
Returns a JSON string."
  (org-roam-pi--bootstrap)
  (let* ((target-file file)
  (org-roam-pi--dbg (format "create title=%s" title))
         (roam-dir org-roam-pi-directory))
    ;; Auto-pick file if not specified
    (if (not target-file)
        (setq target-file (org-roam-pi--pick-file-for-title title)))
    (if (not target-file)
      (let ((safe-name (replace-regexp-in-string "[^a-z0-9]+" "-"
                                     (replace-regexp-in-string "^-\\|-$" ""
                                                               (downcase title)))))
        (setq target-file (expand-file-name (format "%s.org.gpg" safe-name) roam-dir))))

    ;; Ensure absolute path
    (if (not (file-name-absolute-p target-file))
        (setq target-file (expand-file-name target-file roam-dir)))

    (let* ((org-id (org-roam-pi--generate-id))
           (tag-line (when tags (format ":ROAM_REFS: %s\n" (mapconcat #'identity tags " "))))
           (headline (format "* %s\n:PROPERTIES:\n:ID:       %s\n%s:END:\n\n%s\n"
                             title org-id (or tag-line "") content))
           (existing-content ""))
      ;; Read existing content if file exists
      (when (file-exists-p target-file)
        (let ((existing (org-roam-pi--read-file target-file)))
          (when existing (setq existing-content existing))))

      (let ((combined (concat existing-content "\n" headline "\n")))
        ;; Encrypt and save if .gpg
        (if (string-suffix-p ".gpg" target-file)
            (let ((result (org-roam-pi--encrypt-and-save combined target-file org-roam-pi-gpg-encrypt-to)))
              (if (stringp result)
                  (org-roam-pi--error result)
                (org-roam-pi--json `((status . "created")
                                      (title . ,title)
                                      (id . ,org-id)
                                      (file . ,(file-relative-name target-file roam-dir)))))
          ;; Plain text save
          (with-temp-buffer
            (insert combined)
            (write-region (point-min) (point-max) target-file nil 'nomesg))
          (org-roam-pi--json `((status . "created")
                                (title . ,title)
                                (id . ,org-id)
                                (file . ,(file-relative-name target-file roam-dir))))))))))

;;;###autoload
(defun org-roam-pi-append-journal (content &optional date)
  "Append CONTENT to the journal for DATE (YYYY-MM-DD, defaults to today).
Returns a JSON string."
  (org-roam-pi--bootstrap)
  (let* ((date-str (or date (format-time-string "%Y-%m-%d")))
         (journal-dir (expand-file-name org-roam-pi-journal-directory org-roam-pi-directory))
  (org-roam-pi--dbg (format "append-journal date=%s" (or date "today")))
         (target-file (expand-file-name (format "%s.org.gpg" date-str) journal-dir))
         (timestamp (format-time-string "%Y-%m-%d %H:%M"))
         (headline (format "** %s - Journal Entry\n%s\n" timestamp content)))
    (if (not (file-directory-p journal-dir))
        (make-directory journal-dir t))

    (let* ((existing-content (org-roam-pi--read-file target-file))
           (combined (concat (or existing-content "") headline "\n"))
           (result (org-roam-pi--encrypt-and-save combined target-file org-roam-pi-gpg-encrypt-to)))
      (if (stringp result)
          (org-roam-pi--error result)
        (org-roam-pi--json `((status . "appended")
                              (date . ,date-str)
                              (file . ,(file-relative-name target-file org-roam-pi-directory))))))))

(defun org-roam-pi--build-entry-neighborhood ()
  "Build entry node neighborhood section.
Returns a string of markdown text."
  (let* ((capped-nodes (seq-take org-roam-pi-entry-nodes org-roam-pi-entry-node-cap))
         (all-nodes (org-roam-pi--node-list))
         (sections '()))
    (dolist (entry-title capped-nodes)
      (let ((entry-node (org-roam-pi--node-from-title entry-title)))
        (when entry-node
          (let ((lines (list (format "## %s" entry-title))))
            ;; Properties (only show if non-empty after filtering)
            (let* ((props (org-roam-pi--node-properties entry-node))
                   (filtered '()))
              (when props
                (dolist (key (mapcar #'car props))
                  (when-let* ((val (cdr (assoc key props)))
                              ((not (member key '("ID" "FILE" "BLOCKED")))))
                    (push (format "  - %s: %s" key val) filtered))))
              (when filtered
                (push "Properties:" lines)
                (dolist (p (nreverse filtered))
                  (push p lines))))
            ;; Body text (first-level paragraphs and bullet points)
            (when-let* ((body-text (org-roam-pi--extract-node-body entry-node 500)))
              (dolist (line (split-string body-text "\n"))
                (when (string-trim line)
                  (push (format "  %s" line) lines))))
            ;; Connected nodes from link cache
            (let* ((entry-id (org-roam-pi--node-id entry-node))
                   (outgoing-ids (org-roam-pi--node-outgoing entry-id))
                   (linked-nodes '()))
              (dolist (dest-id outgoing-ids)
                (let ((dest-node (org-roam-pi--node-from-id dest-id)))
                  (when dest-node
                    (push (format "- -> %s" (org-roam-pi--node-title dest-node))
                          linked-nodes))))
              (when linked-nodes
                (push "Connected nodes:" lines)
                (dolist (ln (seq-take (nreverse linked-nodes) 20))
                  (push ln lines))))
            ;; Append this entry's section
            (push (mapconcat #'identity (nreverse lines) "\n") sections)))))
    (mapconcat #'identity sections "\n\n")))

(defun org-roam-pi--build-open-todos ()
  "Build open TODO section.
Returns a string of markdown text."
  (if (not org-roam-pi-include-open-todos)
      ""
    (let* ((all-nodes (org-roam-pi--node-list))
           (todos '()))
      ;; Collect open todos
      (dolist (node all-nodes)
        (let* ((todo (org-roam-pi--node-todo node))
               (priority (org-roam-pi--node-priority node)))
          (when (and todo
                     (not (member todo '("DONE" "" nil)))
                     (stringp todo))
            (push `((todo . ,todo)
                    (title . ,(org-roam-pi--node-title node))
                    (priority . ,(or priority ""))
                    (file . ,(file-relative-name (org-roam-pi--node-file node) org-roam-pi-directory)))
                  todos))))
      ;; Sort by todo keyword priority
      (setq todos (seq-sort (lambda (a b)
                              (let* ((ta (cdr (assoc 'todo a)))
                                     (tb (cdr (assoc 'todo b)))
                                     (ra (pcase ta
                                           ("WAITING" 1) ("NEXT" 2) ("TODO" 3) (_ 4)))
                                     (rb (pcase tb
                                           ("WAITING" 1) ("NEXT" 2) ("TODO" 3) (_ 4))))
                                (< ra rb)))
                            todos))
      ;; Format output
      (when todos
        (let ((lines '("## Open TODOs")))
          (dolist (t (seq-take todos 30))
            (let* ((todo (cdr (assoc 'todo t)))
                   (title (cdr (assoc 'title t)))
                   (pri (cdr (assoc 'priority t)))
                   (file (cdr (assoc 'file t))))
              (push (format "- [%s] %s%s (%s)" todo title
                            (if (not (string= pri "")) (format " [#%s]" pri) "")
                            file)
                    lines)))
          (mapconcat #'identity (nreverse lines) "\n"))))))

(defun org-roam-pi--extract-journal-date (file-path)
  "Extract YYYY-MM-DD from a journal FILE-PATH, or nil."
  (let ((match (string-match "/journal/\\([0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}\\)" file-path)))
    (when match
      (substring file-path (match-beginning 1) (match-end 1)))))

(defun org-roam-pi--build-journal-entries ()
  "Build journal entries section.
Returns a string of markdown text."
  (let* ((all-nodes (org-roam-pi--node-list))
         (journal-nodes (seq-filter (lambda (n)
                                      (and (= (org-roam-pi--node-level n) 0)
                                           (string-match-p "/journal/" (org-roam-pi--node-file n))))
                                    all-nodes))
         (today (current-time))
         (recent-cutoff (time-add today (days-to-time (* -1 org-roam-pi-journal-recent-days))))
         (titles-only-cutoff (time-add today (days-to-time (* -1 org-roam-pi-journal-titles-only-days))))
         (sections '()))
    ;; Sort by title descending
    (setq journal-nodes (seq-sort (lambda (a b)
                                    (string< (org-roam-pi--node-title b)
                                              (org-roam-pi--node-title a)))
                                  journal-nodes))
    (dolist (node journal-nodes)
      (let* ((file (org-roam-pi--node-file node))
             (date-str (org-roam-pi--extract-journal-date file)))
        (when date-str
          (let* ((year (string-to-number (substring date-str 0 4)))
                 (month (string-to-number (substring date-str 5 7)))
                 (day (string-to-number (substring date-str 8 10)))
                 (entry-time (encode-time 0 0 12 day month year)))
            ;; Skip if older than titles-only cutoff
            (if (not (time-less-p entry-time titles-only-cutoff))
              (if (time-less-p recent-cutoff entry-time)
                  ;; Recent: decrypt and show content
                  (let* ((content (org-roam-pi--read-file file))
                         (lines (list (format "### %s" date-str))))
                    (when content
                      (let ((paragraphs (seq-filter (lambda (p)
                                                      (and (not (string-prefix-p "#+" p))
                                                           (string-trim p)))
                                                    (split-string content "\n\n"))))
                        (dolist (p (seq-take paragraphs 3))
                          (push (substring (string-trim p) 0 200) lines))))
                    (push (mapconcat #'identity (nreverse lines) "\n") sections))
                ;; Older: child headlines only — parse file for sub-headlines
                (let* ((children (seq-filter (lambda (n)
                                               (and (> (org-roam-pi--node-level n) 0)
                                                    (string= (org-roam-pi--node-file n) file)))
                                             all-nodes))
                       (lines (list (format "#### %s" date-str))))
                  (dolist (child (seq-take children 10))
                    (push (format "- %s" (org-roam-pi--node-title child)) lines))
                  (push (mapconcat #'identity (nreverse lines) "\n") sections))))))
    (mapconcat #'identity (nreverse sections) "\n")))))

(defun org-roam-pi--build-recent-modifications ()
  "Build recently modified files section using filesystem timestamps.
Returns a string of markdown text."
  (let* ((one-day-ago (- (float-time) (* 24 60 60)))
         (all-files (org-roam-pi--all-org-files))
         (recent '())
         (lines '("## Recently Modified")))
    (dolist (f all-files)
      (let* ((attrs (file-attributes f))
             (mtime (float-time (file-attribute-modification-time attrs))))
        (when (> mtime one-day-ago)
          (push `((file . ,f) (mtime . ,mtime)) recent))))
    ;; Sort by mtime descending
    (setq recent (seq-sort (lambda (a b)
                             (> (cdr (assoc 'mtime a))
                                (cdr (assoc 'mtime b))))
                           recent))
    (dolist (f (seq-take recent 10))
      (let* ((file-path (cdr (assoc 'file f)))
             (mtime (cdr (assoc 'mtime f)))
             (short-file (file-relative-name file-path org-roam-pi-directory))
             (time-str (format-time-string "%Y-%m-%d %H:%M" mtime)))
        (push (format "- %s (%s)" short-file time-str) lines)))
    (when (> (length lines) 1)
      (mapconcat #'identity (nreverse lines) "\n"))))

(defun org-roam-pi--truncate-middle (text max-chars)
  "Truncate TEXT to MAX-CHARS by cutting the middle."
  (if (<= (length text) max-chars)
      text
    (let ((half (/ (- max-chars 6) 2)))
      (concat (substring text 0 half)
              "\n...\n"
              (substring text (- (length text) half))))))

;;;###autoload
(defun org-roam-pi-memory-context ()
  "Build the full ambient memory context from org-roam.
Returns a JSON string with the assembled markdown context."
  (org-roam-pi--bootstrap)
  (org-roam-pi--dbg "memory-context building...")
  (let* ((builders '(("entry" . org-roam-pi--build-entry-neighborhood)
                     ("todos" . org-roam-pi--build-open-todos)
                     ("journal" . org-roam-pi--build-journal-entries)
                     ("recent" . org-roam-pi--build-recent-modifications)))
         (budgets '(("entry" . 2000)
                    ("todos" . 2000)
                    ("journal" . 3000)
                    ("recent" . 1000)))
         (total-budget org-roam-pi-ambient-cap-chars)
         (results '())
         (used-chars 0))
    (dolist (sec builders)
      (let* ((name (car sec))
             (fn-name (cdr sec))
             (budget (cdr (assoc name budgets)))
             (text (funcall fn-name)))
        (when text
          (let ((effective-budget (min budget (- total-budget used-chars))))
            (when (> effective-budget 0)
              (let ((truncated nil))
                (when (> (length text) effective-budget)
                  (setq text (org-roam-pi--truncate-middle text effective-budget)
                        truncated t))
                (push `((text . ,text) (truncated . ,truncated)) results)
                (cl-incf used-chars (length text))))))))
    (let ((final-text (mapconcat (lambda (r)
                                   (let ((txt (cdr (assoc 'text r)))
                                         (trunc (cdr (assoc 'truncated r))))
                                     (if trunc
                                         (concat txt "\n<!-- truncated -->")
                                       txt)))
                                 (nreverse results)
                                 "\n\n")))
      (org-roam-pi--dbg (format "memory-context done (%d chars)" (length final-text)))
      (with-temp-buffer
        (insert final-text)
        (write-region (point-min) (point-max) org-roam-pi--context-log t))
      (org-roam-pi--json `((context . ,final-text)
                            (chars . ,(length final-text)))))))

;;;###autoload
(defun org-roam-pi-list-nodes (&optional max-nodes)
  "List all org-roam nodes as JSON.
MAX-NODES caps the output (default 100).
Returns a JSON string."
  (org-roam-pi--bootstrap)
  (org-roam-pi--dbg (format "list-nodes max=%s" (or max-nodes 100)))
  (let* ((max (or max-nodes 100))
         (results '()))
    (dolist (node (seq-take (org-roam-pi--node-list) max))
      (push (org-roam-pi--node-to-map node org-roam-pi-directory) results))
    (org-roam-pi--json (nreverse results))))

(provide 'org-roam-pi-memory)
;;; org-roam-pi-memory.el ends here
