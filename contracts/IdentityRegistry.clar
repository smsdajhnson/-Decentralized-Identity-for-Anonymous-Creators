(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-PSEUDONYM u101)
(define-constant ERR-INVALID-PUBKEY u102)
(define-constant ERR-INVALID-TIMESTAMP u103)
(define-constant ERR-IDENTITY-ALREADY-EXISTS u104)
(define-constant ERR-IDENTITY-NOT-FOUND u105)
(define-constant ERR-INVALID-MAX-IDENTITIES u106)
(define-constant ERR-MAX-IDENTITIES-EXCEEDED u107)
(define-constant ERR-INVALID-STATUS u108)
(define-constant ERR-INVALID-METADATA u109)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u110)
(define-constant ERR-INVALID-ATTRIBUTE u111)
(define-constant ERR-INVALID-RECOVERY-KEY u112)

(define-data-var next-id uint u0)
(define-data-var max-identities uint u10000)
(define-data-var creation-fee uint u500)
(define-data-var authority-contract (optional principal) none)

(define-map identities
  { id: uint }
  { pseudonym: (string-utf8 50), pubkey: (string-utf8 256), created-at: uint, status: bool, metadata: (string-utf8 200) })

(define-map identities-by-pseudonym
  { pseudonym: (string-utf8 50) }
  { id: uint })

(define-map identity-attributes
  { id: uint, attribute-key: (string-utf8 50) }
  { value: (string-utf8 100), updated-at: uint })

(define-map recovery-keys
  { id: uint }
  { recovery-key: (string-utf8 256) })

(define-read-only (get-identity (id uint))
  (map-get? identities { id: id }))

(define-read-only (get-identity-by-pseudonym (pseudonym (string-utf8 50)))
  (match (map-get? identities-by-pseudonym { pseudonym: pseudonym })
    entry (map-get? identities { id: (get id entry) })
    none))

(define-read-only (get-attribute (id uint) (key (string-utf8 50)))
  (map-get? identity-attributes { id: id, attribute-key: key }))

(define-read-only (get-recovery-key (id uint))
  (map-get? recovery-keys { id: id }))

(define-read-only (get-identity-count)
  (var-get next-id))

(define-read-only (is-identity-registered (pseudonym (string-utf8 50)))
  (is-some (map-get? identities-by-pseudonym { pseudonym: pseudonym })))

(define-private (validate-pseudonym (pseudonym (string-utf8 50)))
  (if (and (> (len pseudonym) u0) (<= (len pseudonym) u50))
      (ok true)
      (err ERR-INVALID-PSEUDONYM)))

(define-private (validate-pubkey (pubkey (string-utf8 256)))
  (if (and (> (len pubkey) u0) (<= (len pubkey) u256))
      (ok true)
      (err ERR-INVALID-PUBKEY)))

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP)))

(define-private (validate-metadata (metadata (string-utf8 200)))
  (if (<= (len metadata) u200)
      (ok true)
      (err ERR-INVALID-METADATA)))

(define-private (validate-attribute-key (key (string-utf8 50)))
  (if (and (> (len key) u0) (<= (len key) u50))
      (ok true)
      (err ERR-INVALID-ATTRIBUTE)))

(define-private (validate-recovery-key (key (string-utf8 256)))
  (if (and (> (len key) u0) (<= (len key) u256))
      (ok true)
      (err ERR-INVALID-RECOVERY-KEY)))

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED)))

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)))

(define-public (set-max-identities (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-INVALID-MAX-IDENTITIES))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-identities new-max)
    (ok true)))

(define-public (set-creation-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set creation-fee new-fee)
    (ok true)))

(define-public (register-identity (pseudonym (string-utf8 50)) (pubkey (string-utf8 256)) (metadata (string-utf8 200)))
  (let ((id (var-get next-id))
        (authority (var-get authority-contract)))
    (asserts! (< id (var-get max-identities)) (err ERR-MAX-IDENTITIES-EXCEEDED))
    (try! (validate-pseudonym pseudonym))
    (try! (validate-pubkey pubkey))
    (try! (validate-metadata metadata))
    (asserts! (is-none (map-get? identities-by-pseudonym { pseudonym: pseudonym })) (err ERR-IDENTITY-ALREADY-EXISTS))
    (asserts! (is-some authority) (err ERR-AUTHORITY-NOT-VERIFIED))
    (try! (stx-transfer? (var-get creation-fee) tx-sender (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
    (map-set identities { id: id }
      { pseudonym: pseudonym, pubkey: pubkey, created-at: block-height, status: true, metadata: metadata })
    (map-set identities-by-pseudonym { pseudonym: pseudonym } { id: id })
    (var-set next-id (+ id u1))
    (print { event: "identity-registered", id: id, pseudonym: pseudonym })
    (ok id)))

(define-public (update-identity (id uint) (new-pseudonym (string-utf8 50)) (new-metadata (string-utf8 200)))
  (let ((identity (map-get? identities { id: id })))
    (match identity
      id-data
      (begin
        (asserts! (is-eq (get creator id-data) tx-sender) (err ERR-NOT-AUTHORIZED))
        (try! (validate-pseudonym new-pseudonym))
        (try! (validate-metadata new-metadata))
        (asserts! (or (is-eq (get pseudonym id-data) new-pseudonym)
                      (is-none (map-get? identities-by-pseudonym { pseudonym: new-pseudonym })))
                  (err ERR-IDENTITY-ALREADY-EXISTS))
        (map-delete identities-by-pseudonym { pseudonym: (get pseudonym id-data) })
        (map-set identities-by-pseudonym { pseudonym: new-pseudonym } { id: id })
        (map-set identities { id: id }
          { pseudonym: new-pseudonym,
            pubkey: (get pubkey id-data),
            created-at: (get created-at id-data),
            status: (get status id-data),
            metadata: new-metadata })
        (print { event: "identity-updated", id: id, pseudonym: new-pseudonym })
        (ok true))
      (err ERR-IDENTITY-NOT-FOUND))))

(define-public (set-attribute (id uint) (key (string-utf8 50)) (value (string-utf8 100)))
  (let ((identity (map-get? identities { id: id })))
    (match identity
      id-data
      (begin
        (asserts! (is-eq (get creator id-data) tx-sender) (err ERR-NOT-AUTHORIZED))
        (try! (validate-attribute-key key))
        (map-set identity-attributes { id: id, attribute-key: key }
          { value: value, updated-at: block-height })
        (print { event: "attribute-set", id: id, key: key })
        (ok true))
      (err ERR-IDENTITY-NOT-FOUND))))

(define-public (set-recovery-key (id uint) (recovery-key (string-utf8 256)))
  (let ((identity (map-get? identities { id: id })))
    (match identity
      id-data
      (begin
        (asserts! (is-eq (get creator id-data) tx-sender) (err ERR-NOT-AUTHORIZED))
        (try! (validate-recovery-key recovery-key))
        (map-set recovery-keys { id: id } { recovery-key: recovery-key })
        (print { event: "recovery-key-set", id: id })
        (ok true))
      (err ERR-IDENTITY-NOT-FOUND))))

(define-public (deactivate-identity (id uint))
  (let ((identity (map-get? identities { id: id })))
    (match identity
      id-data
      (begin
        (asserts! (is-eq (get creator id-data) tx-sender) (err ERR-NOT-AUTHORIZED))
        (map-set identities { id: id }
          { pseudonym: (get pseudonym id-data),
            pubkey: (get pubkey id-data),
            created-at: (get created-at id-data),
            status: false,
            metadata: (get metadata id-data) })
        (print { event: "identity-deactivated", id: id })
        (ok true))
      (err ERR-IDENTITY-NOT-FOUND))))