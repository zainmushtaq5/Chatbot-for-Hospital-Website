import os
import docx2txt
import chromadb
import config
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter

def convert_docx_to_txt(docs_folder):
    if not os.path.exists(docs_folder):
        print(f"Docs folder not found: {docs_folder}")
        return
        
    for filename in os.listdir(docs_folder):
        if filename.endswith(".docx"):
            docx_path = os.path.join(docs_folder, filename)
            txt_path = os.path.join(docs_folder, filename.replace(".docx", ".txt"))
            if not os.path.exists(txt_path):
                print(f"Converting {filename} to .txt...")
                try:
                    text = docx2txt.process(docx_path)
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(text)
                    print(f"Converted {filename} -> {os.path.basename(txt_path)}")
                except Exception as e:
                    print(f"Error converting {filename}: {e}")

def build_knowledge_base():
    # Convert any docx to txt
    convert_docx_to_txt(config.DOCS_PATH)
    
    # Initialize chroma client to check count
    client = chromadb.PersistentClient(path=config.CHROMA_PATH)
    collection_name = "hospital_kb"
    
    try:
        collection = client.get_collection(name=collection_name)
        if collection.count() > 0:
            print("ChromaDB already has documents, skipping re-indexing.")
            return
    except Exception:
        # Collection doesn't exist yet, we will create it
        pass

    print("Loading docs...")
    if not os.path.exists(config.DOCS_PATH):
        print(f"Error: Docs path {config.DOCS_PATH} does not exist.")
        return

    documents = []
    for filename in os.listdir(config.DOCS_PATH):
        if filename.endswith(".txt"):
            file_path = os.path.join(config.DOCS_PATH, filename)
            with open(file_path, "r", encoding="utf-8") as f:
                documents.append({"text": f.read(), "source": filename})
                
    if not documents:
        print("No .txt documents found to index.")
        return

    print("Splitting text into chunks...")
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    
    chunks = []
    metadatas = []
    for doc in documents:
        split_texts = text_splitter.split_text(doc["text"])
        for i, text in enumerate(split_texts):
            chunks.append(text)
            metadatas.append({"source": doc["source"], "chunk_id": i})

    print("Building embeddings...")
    embeddings = HuggingFaceEmbeddings(model_name=config.EMBEDDING_MODEL)
    
    # Create the vector store
    vector_store = Chroma.from_texts(
        texts=chunks,
        embedding=embeddings,
        metadatas=metadatas,
        collection_name=collection_name,
        persist_directory=config.CHROMA_PATH
    )
    print("Done.")

def search_knowledge_base(query, n_results=4):
    embeddings = HuggingFaceEmbeddings(model_name=config.EMBEDDING_MODEL)
    vector_store = Chroma(
        collection_name="hospital_kb",
        embedding_function=embeddings,
        persist_directory=config.CHROMA_PATH
    )
    
    results = vector_store.similarity_search(query, k=n_results)
    if not results:
        return ""
        
    return "\n\n".join([doc.page_content for doc in results])

if __name__ == "__main__":
    import sys
    # If 'build' argument is passed
    if len(sys.argv) > 1 and sys.argv[1] == "build":
        build_knowledge_base()
    elif len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
        print(f"Searching for: '{query}'")
        res = search_knowledge_base(query)
        print("Results:\n", res)
    else:
        print("Usage: python rag.py build | python rag.py <search query>")
