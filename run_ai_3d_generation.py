import os
import shutil
import sys
from gradio_client import Client, handle_file

print("A inicializar cliente de IA 3D (Microsoft TRELLIS via HuggingFace)...")
image_path = os.path.abspath("public/images/santuario_sanfins.jpg")
print(f"Fotografia de entrada: {image_path}")

try:
    client = Client("trellis-community/TRELLIS")
    print("Ligado com sucesso ao servidor TRELLIS!")

    # 1. Preprocess image
    print("Passo 1/2: A pré-processar imagem arquitetónica...")
    prep_result = client.predict(
        image=handle_file(image_path),
        api_name="/preprocess_image"
    )
    print("Imagem pré-processada:", prep_result)

    # 2. Generate and extract 3D GLB model
    print("Passo 2/2: A gerar malha volumétrica 3D e texturas PBR (isto pode demorar 1-2 minutos)...")
    res = client.predict(
        image=handle_file(prep_result),
        multiimages=[],
        seed=42,
        ss_guidance_strength=7.5,
        ss_sampling_steps=12,
        slat_guidance_strength=3.0,
        slat_sampling_steps=12,
        multiimage_algo="stochastic",
        mesh_simplify=0.95,
        texture_size=1024,
        api_name="/generate_and_extract_glb"
    )
    
    print("Resultado da inferência:", res)
    # res is (generated_3d_asset, extracted_glbgaussian, download_glb)
    glb_path = res[2] if len(res) > 2 else res[1]
    print(f"Ficheiro GLB gerado pelo modelo de IA: {glb_path}")

    # Copy to public/models/santuario_sanfins.glb
    dest_path = os.path.abspath("public/models/santuario_sanfins.glb")
    shutil.copyfile(glb_path, dest_path)
    print(f"SUCESSO! Modelo 3D substituído com sucesso em: {dest_path} (Tamanho: {os.path.getsize(dest_path)} bytes)")

except Exception as e:
    import traceback
    traceback.print_exc()
    sys.exit(1)
