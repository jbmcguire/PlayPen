import SwiftUI
import SwiftData

struct SidebarView: View {
    @Binding var selection: SidebarSelection?
    @Binding var selectedPlayground: Playground?
    @Environment(\.modelContext) private var modelContext
    @Query(sort: [SortDescriptor(\Project.sortIndex), SortDescriptor(\Project.name)]) private var projects: [Project]
    @Query(sort: \Tag.name) private var tags: [Tag]
    @State private var isAddingProject = false
    @State private var isShowingHostedLibrary = false
    @State private var isShowingHostedServiceSettings = false
    @State private var newProjectName = ""

    var body: some View {
        List(selection: $selection) {
            Label("All Playgrounds", systemImage: "square.stack.3d.up")
                .tag(SidebarSelection.all)

            Section("Projects") {
                ForEach(projects) { project in
                    Label(project.name, systemImage: "folder")
                        .tag(SidebarSelection.project(project))
                        .badge(project.playgrounds?.count ?? 0)
                        .contextMenu {
                            Button("Delete Project", systemImage: "trash", role: .destructive) {
                                deleteProject(project)
                            }
                        }
                }
                .onMove(perform: moveProjects)
                .reorderable()
            }

            Section("Tags") {
                ForEach(tags) { tag in
                    Label(tag.name, systemImage: "tag")
                        .tag(SidebarSelection.tag(tag))
                        .badge(tag.playgrounds?.count ?? 0)
                        .contextMenu {
                            Button("Delete Tag", systemImage: "trash", role: .destructive) {
                                deleteTag(tag)
                            }
                        }
                }
            }
        }
        .navigationTitle("PlayPen")
        .toolbar {
            ToolbarItem {
                Menu("Library Actions", systemImage: "ellipsis.circle") {
                    Button("New Project", systemImage: "folder.badge.plus") {
                        isAddingProject = true
                    }
                    Button("Hosted Service", systemImage: "network") {
                        isShowingHostedServiceSettings = true
                    }
                    Button("Hosted Library", systemImage: "tray.full") {
                        isShowingHostedLibrary = true
                    }
                }
            }
        }
        .alert("New Project", isPresented: $isAddingProject) {
            TextField("Project name", text: $newProjectName)
            Button("Create") { createProject() }
            Button("Cancel", role: .cancel) { newProjectName = "" }
        }
        .sheet(isPresented: $isShowingHostedServiceSettings) {
            HostedServiceSettingsView()
        }
        .sheet(isPresented: $isShowingHostedLibrary) {
            HostedLibraryView(selectedPlayground: $selectedPlayground, sidebarSelection: $selection)
        }
    }

    private func createProject() {
        let trimmedName = newProjectName.trimmingCharacters(in: .whitespaces)
        newProjectName = ""
        guard !trimmedName.isEmpty else { return }
        let project = Project(name: trimmedName)
        modelContext.insert(project)
        selection = .project(project)
    }

    private func moveProjects(from source: IndexSet, to destination: Int) {
        var reorderedProjects = projects
        reorderedProjects.move(fromOffsets: source, toOffset: destination)
        for (index, project) in reorderedProjects.enumerated() {
            project.sortIndex = index
        }
    }

    private func deleteProject(_ project: Project) {
        if case .project(let selectedProject) = selection, selectedProject == project {
            selection = .all
        }
        modelContext.delete(project)
    }

    private func deleteTag(_ tag: Tag) {
        if case .tag(let selectedTag) = selection, selectedTag == tag {
            selection = .all
        }
        modelContext.delete(tag)
    }
}
