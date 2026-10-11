import SwiftUI

/// 首次使用（还没有公司）时的欢迎页：拖入文件开始，或手动建立、或看示例数据。
struct FirstRunView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @State private var confirmSample = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("把公司文件交给 Charter，剩下的它来整理。")
                    .font(.system(size: 40, weight: .heavy)).tracking(-1.2)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text("拖入注册证书、章程、董事名册、存续证明。Charter 会识别属于哪家公司、是什么文件、何时签发，并告诉你哪些用途已经可以随时出材料。")
                    .font(.system(size: 15)).foregroundStyle(Theme.muted)
                    .frame(maxWidth: 620, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 10)

                dropZone.padding(.top, 28)
                alternatives.padding(.top, 20)

                HStack(spacing: 8) {
                    Circle().fill(Theme.lime).frame(width: 7, height: 7)
                    Text("文件只保存在你的数据文件夹，识别在本机完成。")
                        .font(.system(size: 12.5)).foregroundStyle(Theme.muted)
                }
                .padding(.top, 18)
            }
            .padding(.horizontal, 40).padding(.top, 40).padding(.bottom, 48)
            .frame(maxWidth: 1000, alignment: .leading)
            .frame(maxWidth: .infinity)
            .appear()
        }
        .confirmSheet("载入示例数据？", isPresented: $confirmSample,
                      message: "将载入一个虚构的远澜集团，12 家公司，用来先看看 Charter 的样子。之后可以在设置里随时清空。",
                      confirmTitle: "载入示例数据") {
            SampleData.install(into: store)
        }
    }

    // MARK: 拖放区

    private var dropZone: some View {
        ArchiveDropZone(title: "把 PDF 或照片拖到这里",
                        subtitle: "也可以拖入整个文件夹。或者点这里，选择要导入的文件。",
                        action: { router.chooseFiles(context: nil) },
                        onDrop: { urls in router.startImport(urls: urls, context: nil) })
    }

    // MARK: 其他开始方式

    private var alternatives: some View {
        HStack(spacing: 0) {
            Button { router.sheet = .newGroup } label: {
                choice("从一家顶层公司开始", "手动建立集团和公司，之后再补文件。")
            }
            Rectangle().fill(Theme.hairline).frame(width: 1)
            Button { confirmSample = true } label: {
                choice("先看示例数据", "一个虚构的远澜集团，12 家公司，可随时清空。")
            }
        }
        .buttonStyle(ChoiceButtonStyle())
        .fixedSize(horizontal: false, vertical: true)
        .background(Theme.surface, in: .rect(cornerRadius: Radius.surface, style: .continuous))
        .clipShape(.rect(cornerRadius: Radius.surface, style: .continuous))
    }

    private func choice(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
            Text(detail).font(.system(size: 13)).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 22).padding(.vertical, 20)
    }
}

/// 两个并排选择：悬停时浅灰底。
private struct ChoiceButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        ChoiceBody(configuration: configuration)
    }

    private struct ChoiceBody: View {
        var configuration: ButtonStyleConfiguration
        @State private var hover = false

        var body: some View {
            configuration.label
                .frame(maxHeight: .infinity, alignment: .topLeading)
                .background(hover || configuration.isPressed ? Theme.band : Color.clear)
                .contentShape(.rect)
                .onHover { hover = $0 }
                .animation(Motion.fast, value: hover)
        }
    }
}
