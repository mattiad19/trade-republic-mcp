import Foundation
import Security

private let service = "de.local.trade-republic-mcp"
private let account = "web-session"

enum HelperError: Error {
    case invalidCommand
    case invalidInput
    case keychain(OSStatus)
}

private func baseQuery() -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
    ]
}

private func readSecret() throws -> Data? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = item as? Data else {
        throw HelperError.keychain(status)
    }
    return data
}

private func writeSecret(_ data: Data) throws {
    let query = baseQuery()
    let attributes = [kSecValueData as String: data]
    let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if updateStatus == errSecItemNotFound {
        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw HelperError.keychain(addStatus) }
    } else if updateStatus != errSecSuccess {
        throw HelperError.keychain(updateStatus)
    }
}

private func deleteSecret() throws {
    let status = SecItemDelete(baseQuery() as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
        throw HelperError.keychain(status)
    }
}

do {
    guard CommandLine.arguments.count == 2 else { throw HelperError.invalidCommand }
    switch CommandLine.arguments[1] {
    case "get":
        if let secret = try readSecret() { FileHandle.standardOutput.write(secret) }
    case "set":
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard !data.isEmpty else { throw HelperError.invalidInput }
        try writeSecret(data)
    case "delete":
        try deleteSecret()
    default:
        throw HelperError.invalidCommand
    }
} catch HelperError.keychain(let status) {
    let message = SecCopyErrorMessageString(status, nil) as String? ?? "unknown keychain error"
    FileHandle.standardError.write(Data("Keychain operation failed: \(message)\n".utf8))
    exit(2)
} catch {
    FileHandle.standardError.write(Data("Invalid keychain-helper request\n".utf8))
    exit(1)
}
